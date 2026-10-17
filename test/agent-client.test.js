'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentClient } = require('../platform/windows/agent-client');

function createFakeAgentScript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-fake-agent-'));
  const scriptPath = path.join(dir, 'fake-agent.js');
  const code = `'use strict';
const readline = require('node:readline');

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

send({ event: 'ready', version: '1', dpiAware: true, elevated: false, session: 1, user: 'Letzus' });

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const req = JSON.parse(line);
  if (req.op === 'ping') {
    send({ id: req.id, ok: true });
  } else if (req.op === 'echo') {
    send({ id: req.id, ok: true, value: req.value });
  } else if (req.op === 'fail') {
    send({ id: req.id, ok: false, error: 'Fallo simulado' });
  } else if (req.op === 'emit-events') {
    send({ event: 'desktop', state: req.state || 'secure' });
    send({ event: 'displays-changed' });
    send({ id: req.id, ok: true });
  } else if (req.op === 'crash') {
    process.exit(2);
  } else if (req.op === 'stall') {
    // No responde para probar timeout
  } else {
    send({ id: req.id, ok: false, error: 'Desconocida' });
  }
});
rl.on('close', () => process.exit(0));
`;
  fs.writeFileSync(scriptPath, code, 'utf8');
  return { dir, scriptPath };
}

test('AgentClient habla el protocolo JSON-lines, propaga eventos, relanza al morir y cierra limpio', async () => {
  const { dir, scriptPath } = createFakeAgentScript();
  const client = new AgentClient({
    agentPath: scriptPath,
    readyTimeoutMs: 3000,
    callTimeoutMs: 250,
    baseRetryMs: 80,
    maxRetryMs: 400
  });

  try {
    const ready = await client.start();
    assert.equal(ready.event, 'ready');
    assert.equal(ready.dpiAware, true);

    const pong = await client.call('ping');
    assert.equal(pong.ok, true);

    const echoed = await client.call('echo', { value: 'hola' });
    assert.equal(echoed.value, 'hola');

    await assert.rejects(() => client.call('fail'), /Fallo simulado/);
    await assert.rejects(() => client.call('stall', {}, 120), /Tiempo de espera agotado/);

    // Eventos asíncronos
    const desktopStates = [];
    let displaysChangedCount = 0;
    client.on('desktop-state', st => desktopStates.push(st));
    client.on('displays-changed', () => { displaysChangedCount++; });

    await client.call('emit-events', { state: 'secure' });
    assert.deepEqual(desktopStates, ['secure']);
    assert.equal(displaysChangedCount, 1);

    // Caída del agente: rechaza la petición en curso y relanza automáticamente
    await assert.rejects(() => client.call('crash'), /nexo-agent terminó inesperadamente/);

    // Esperar al relanzado automático
    await new Promise(r => setTimeout(r, 220));
    const afterCrash = await client.call('ping');
    assert.equal(afterCrash.ok, true);
  } finally {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
