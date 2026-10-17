'use strict';

const { spawn } = require('child_process');

function runCommand(command, args, maxBytes = 20 * 1024 * 1024, options = {}) {
  const env = options.env || process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    const chunks = [];
    let size = 0;
    let err = '';
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(err.trim() || `${command} terminó con ${code}`)));
  });
}

function runCommandInput(command, args, input, options = {}) {
  const env = options.env || process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], env });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err.trim() || `${command} terminó con ${code}`)));
    child.stdin.end(input);
  });
}

function startCommandInput(command, args, input, readyDelay = 25, options = {}) {
  const env = options.env || process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], env });
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = finish(reject);
    child.on('error', fail);
    child.stderr.on('data', chunk => {
      const message = chunk.toString().trim();
      if (message) fail(new Error(message));
    });
    child.stdin.on('error', fail);
    child.stdin.end(input);
    // A paste-once clipboard owner intentionally stays alive until Ctrl+V.
    // Do not wait for its stdin/close callback here: that would wait for the
    // very paste this queued job still has to emit.
    setTimeout(finish(resolve), readyDelay);
  });
}

function procesoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = existe pero no es nuestro: sigue vivo para lo que aquí importa.
    return error.code === 'EPERM';
  }
}

// Apaga un proceso y todos sus descendientes. En Windows `child.kill()` es
// TerminateProcess: no limpia y deja huérfanos a los nietos (ffmpeg, puente,
// cloudflared), que siguen ocupando puertos y la sesión NVENC. `taskkill /T /F`
// recorre el árbol. `graceMs` da tiempo a que el proceso salga solo (apagado por
// IPC o por cierre de stdin) antes de forzarlo; si ya murió no se hace nada, así
// no se golpea a un PID reutilizado. Nunca rechaza: apagar es "mejor esfuerzo".
async function killTree(pid, graceMs = 0) {
  const objetivo = Number(pid);
  if (!Number.isInteger(objetivo) || objetivo <= 0 || objetivo === process.pid) return false;

  const limite = Date.now() + Math.max(0, Number(graceMs) || 0);
  while (procesoVivo(objetivo) && Date.now() < limite) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!procesoVivo(objetivo)) return false;

  if (process.platform !== 'win32') {
    try { process.kill(objetivo, 'SIGKILL'); } catch {}
    return true;
  }
  await new Promise(resolve => {
    const child = spawn('taskkill', ['/PID', String(objetivo), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    child.on('error', resolve);
    child.on('close', resolve);
  });
  return true;
}

module.exports = { runCommand, runCommandInput, startCommandInput, killTree };
