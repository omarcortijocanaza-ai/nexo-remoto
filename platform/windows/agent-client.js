'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const { killTree } = require('../../lib/proc');

const DEFAULT_AGENT_PATH = path.join(__dirname, '..', '..', 'bin', 'win', 'nexo-agent.exe');

class AgentClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.agentPath = options.agentPath || process.env.NEXO_AGENT_PATH || DEFAULT_AGENT_PATH;
    this.readyTimeoutMs = Number(options.readyTimeoutMs) || 5000;
    this.callTimeoutMs = Number(options.callTimeoutMs) || 2000;
    this.baseRetryMs = Number(options.baseRetryMs) || 500;
    this.maxRetryMs = Number(options.maxRetryMs) || 8000;
    this.closeTimeoutMs = Number(options.closeTimeoutMs) || 1000;
    this.log = typeof options.log === 'function' ? options.log : () => {};

    this.child = null;
    this.rl = null;
    this.ready = false;
    this.readyInfo = null;
    this.closed = false;
    this.nextId = 1;
    this.pending = new Map();
    this.retryAttempt = 0;
    this.retryTimer = null;
    this.startPromise = null;

    this._onProcessExit = () => {
      if (this.child) {
        try { this.child.stdin?.end(); } catch {}
        try { this.child.kill(); } catch {}
      }
    };
    process.on('exit', this._onProcessExit);
  }

  _refChild() {
    if (!this.child) return;
    try { this.child.ref?.(); } catch {}
    try { this.child.stdout?.ref?.(); } catch {}
    try { this.child.stderr?.ref?.(); } catch {}
  }

  _unrefChildIfIdle() {
    if (!this.child || !this.ready || this.pending.size > 0) return;
    try { this.child.unref?.(); } catch {}
    try { this.child.stdout?.unref?.(); } catch {}
    try { this.child.stderr?.unref?.(); } catch {}
    try { this.child.stdin?.unref?.(); } catch {}
  }

  start() {
    if (this.closed) {
      this.closed = false;
    }
    if (this.ready && this.child) {
      return Promise.resolve(this.readyInfo);
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this._spawnAndWaitReady().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  _spawnAndWaitReady() {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        return reject(new Error('Cliente del agente cerrado'));
      }

      const isJs = this.agentPath.toLowerCase().endsWith('.js');
      const cmd = isJs ? process.execPath : this.agentPath;
      const args = isJs ? [this.agentPath, 'serve'] : ['serve'];

      let settled = false;
      let child;
      try {
        child = spawn(cmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch (err) {
        return reject(err);
      }

      this.child = child;
      this.ready = false;
      this._refChild();

      const readyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._forceKillChild(child);
          reject(new Error(`Tiempo de espera agotado (${this.readyTimeoutMs} ms) esperando ready de nexo-agent`));
        }
      }, this.readyTimeoutMs);
      if (readyTimer.unref) readyTimer.unref();

      child.stderr.on('data', chunk => {
        const text = String(chunk).trim();
        if (text) this.log(`[nexo-agent] ${text}`);
      });

      child.stdin.on('error', () => {});

      const rl = readline.createInterface({ input: child.stdout });
      this.rl = rl;

      rl.on('line', line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          this.log(`[nexo-agent] Línea JSON inválida en stdout: ${trimmed.slice(0, 120)}`);
          return;
        }

        if (msg.event) {
          if (msg.event === 'ready') {
            this.ready = true;
            this.readyInfo = msg;
            this.retryAttempt = 0;
            clearTimeout(readyTimer);
            this._unrefChildIfIdle();
            this.emit('ready', msg);
            if (!settled) {
              settled = true;
              resolve(msg);
            }
            return;
          }
          if (msg.event === 'desktop') {
            this.emit('desktop', msg);
            this.emit('desktop-state', msg.state);
            return;
          }
          if (msg.event === 'displays-changed') {
            this.emit('displays-changed', msg);
            return;
          }
          this.emit(msg.event, msg);
          return;
        }

        if (msg.id !== undefined && msg.id !== null && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          this._unrefChildIfIdle();
          if (msg.ok) {
            entry.resolve(msg);
          } else {
            entry.reject(new Error(msg.error || `Error en operación ${entry.op}`));
          }
        }
      });

      const onChildExit = (code, signal) => {
        clearTimeout(readyTimer);
        if (this.rl === rl) {
          try { rl.close(); } catch {}
          this.rl = null;
        }
        if (this.child === child) {
          this.child = null;
          this.ready = false;
        }

        const exitError = new Error(`nexo-agent terminó inesperadamente (código=${code ?? 'null'}, señal=${signal ?? 'null'})`);
        this._rejectAllPending(exitError);

        if (!settled) {
          settled = true;
          reject(exitError);
        }

        if (!this.closed) {
          this._scheduleRelaunch();
        }
      };

      child.once('error', err => {
        clearTimeout(readyTimer);
        this._rejectAllPending(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
        if (!this.closed && this.child === child) {
          this.child = null;
          this.ready = false;
          this._scheduleRelaunch();
        }
      });

      child.once('close', onChildExit);
    });
  }

  _scheduleRelaunch() {
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(this.maxRetryMs, this.baseRetryMs * (2 ** this.retryAttempt));
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed) return;
      this.start().catch(err => {
        this.log(`[nexo-agent] Fallo al relanzar: ${err.message}`);
        this._scheduleRelaunch();
      });
    }, delay);
    if (this.retryTimer.unref) this.retryTimer.unref();
  }

  _rejectAllPending(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  async call(op, params = {}, timeoutMs = this.callTimeoutMs) {
    if (this.closed) {
      throw new Error('Cliente del agente cerrado');
    }
    if (!this.ready || !this.child || !this.child.stdin || this.child.stdin.destroyed) {
      await this.start();
    }
    if (!this.ready || !this.child || !this.child.stdin || this.child.stdin.destroyed) {
      throw new Error('nexo-agent no está disponible');
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ ...params, id, op }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          this._unrefChildIfIdle();
          reject(new Error(`Tiempo de espera agotado (${timeoutMs} ms) en operación ${op}`));
        }
      }, timeoutMs);
      if (timer.unref) timer.unref();

      this.pending.set(id, { op, resolve, reject, timer });
      this._refChild();

      try {
        this.child.stdin.write(payload, err => {
          if (err && this.pending.has(id)) {
            const entry = this.pending.get(id);
            this.pending.delete(id);
            clearTimeout(entry.timer);
            this._unrefChildIfIdle();
            entry.reject(err);
          }
        });
      } catch (err) {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          clearTimeout(timer);
          this._unrefChildIfIdle();
        }
        reject(err);
      }
    });
  }

  _forceKillChild(child) {
    if (!child) return;
    try { child.kill(); } catch {}
    if (child.pid) {
      killTree(child.pid).catch(() => {});
    }
  }

  async close() {
    this.closed = true;
    process.removeListener('exit', this._onProcessExit);
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this._rejectAllPending(new Error('Cliente del agente cerrado'));

    const child = this.child;
    this.child = null;
    this.ready = false;

    if (!child) return;

    this._refChild();
    await new Promise(resolve => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(killTimer);
        resolve();
      };
      child.once('close', done);
      const killTimer = setTimeout(() => {
        this._forceKillChild(child);
        done();
      }, this.closeTimeoutMs);
      if (killTimer.unref) killTimer.unref();

      try {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.end();
        } else {
          this._forceKillChild(child);
          done();
        }
      } catch {
        this._forceKillChild(child);
        done();
      }
    });
  }
}

// Línea de órdenes de un subcomando independiente del agente (audio-loopback,
// audio-play, audio-devices): procesos propios, no pasan por `serve`. Respeta
// NEXO_AGENT_PATH y admite un .js (los agentes falsos de las pruebas).
function agentCommand(subArgs, agentPath = process.env.NEXO_AGENT_PATH || DEFAULT_AGENT_PATH) {
  const isJs = agentPath.toLowerCase().endsWith('.js');
  return isJs
    ? { command: process.execPath, args: [agentPath, ...subArgs] }
    : { command: agentPath, args: [...subArgs] };
}

module.exports = { AgentClient, DEFAULT_AGENT_PATH, agentCommand };
