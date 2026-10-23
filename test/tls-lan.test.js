'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const tls = require('../lib/tls-lan');

const esWindows = process.platform === 'win32';

function carpeta() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-tls-'));
}

test('tls-lan: ipsLan toma las IPv4 externas y descarta loopback, enlace local e IPv6', () => {
  const interfaces = {
    Ethernet: [{ family: 'IPv4', address: '192.168.18.6', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    Sin_DHCP: [{ family: 'IPv4', address: '169.254.7.7', internal: false }],
    Repetida: [{ family: 'IPv4', address: '192.168.18.6', internal: false }]
  };
  assert.deepEqual(tls.ipsLan(interfaces), ['172.20.0.1', '192.168.18.6']);
});

test('tls-lan: sólo se ofrece en Windows y con un mensaje claro en otros sistemas', async () => {
  await assert.rejects(() => tls.asegurarCertificado({ stateDir: carpeta(), plataforma: 'linux' }), /sólo está disponible en Windows/);
});

test('tls-lan: el script de PowerShell lleva las IP y los nombres en el SAN y no la contraseña', () => {
  const script = tls.scriptPowerShell({ nombres: ['localhost', 'MI-PC'], ips: ['127.0.0.1', '192.168.18.6'] });
  assert.match(script, /DNS=localhost&DNS=MI-PC&IPAddress=127\.0\.0\.1&IPAddress=192\.168\.18\.6/);
  assert.match(script, /\$env:NEXO_TLS_PASS/);
  assert.match(script, /Remove-Item -LiteralPath/);
  assert.ok(!/secreto-de-prueba/.test(script));
});

test('tls-lan: reutiliza el certificado vigente y lo regenera si cambia la IP o falta poco para caducar', { skip: !esWindows && 'requiere PowerShell de Windows' }, async () => {
  const dir = carpeta();
  const log = [];
  const a = await tls.asegurarCertificado({ stateDir: dir, ips: ['192.168.18.6'], hostname: 'EQUIPO-PRUEBA', log: m => log.push(m) });
  assert.equal(a.regenerado, true);
  assert.ok(a.pfx.length > 500);
  assert.match(a.passphrase, /^[0-9a-f]{48}$/);

  // La contraseña y el PFX no son legibles por quien no sea el dueño: se comprueba que existan y que la meta la guarde.
  const meta = JSON.parse(fs.readFileSync(path.join(dir, tls.ARCHIVO_META), 'utf8'));
  assert.equal(meta.passphrase, a.passphrase);
  assert.deepEqual(meta.ips, ['127.0.0.1', '192.168.18.6']);

  // Mismos datos: se reutiliza.
  const b = await tls.asegurarCertificado({ stateDir: dir, ips: ['192.168.18.6'], hostname: 'EQUIPO-PRUEBA' });
  assert.equal(b.regenerado, false);
  assert.equal(b.passphrase, a.passphrase);

  // Cambia la IP del equipo: se regenera con la nueva incluida.
  const c = await tls.asegurarCertificado({ stateDir: dir, ips: ['10.0.0.9'], hostname: 'EQUIPO-PRUEBA' });
  assert.equal(c.regenerado, true);
  assert.match(c.motivo, /cambió la red \(10\.0\.0\.9\)/);
  assert.deepEqual(tls.ipsDelCertificado(tls.leerCertificadoPublico(dir)).sort(), ['10.0.0.9', '127.0.0.1']);

  // Falta poco para caducar (reloj adelantado 340 días): se renueva.
  const d = await tls.asegurarCertificado({ stateDir: dir, ips: ['10.0.0.9'], hostname: 'EQUIPO-PRUEBA', ahora: Date.now() + 340 * 24 * 3600 * 1000 });
  assert.equal(d.regenerado, true);
  assert.equal(d.motivo, 'por caducar');
});

test('tls-lan: un servidor HTTPS de Node arranca con el PFX generado y presenta el certificado esperado', { skip: !esWindows && 'requiere PowerShell de Windows' }, async () => {
  const dir = carpeta();
  const { pfx, passphrase } = await tls.asegurarCertificado({ stateDir: dir, ips: ['192.168.18.6'], hostname: 'EQUIPO-PRUEBA' });
  const servidor = https.createServer({ pfx, passphrase }, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`seguro=${Boolean(req.socket.encrypted)}`);
  });
  await new Promise(resolver => servidor.listen(0, '127.0.0.1', resolver));
  try {
    const puerto = servidor.address().port;
    const cuerpo = await new Promise((resolver, rechazar) => {
      // rejectUnauthorized:false = lo que hace el celular al «aceptar el aviso».
      https.get({ host: '127.0.0.1', port: puerto, path: '/', rejectUnauthorized: false }, res => {
        const certificado = res.socket.getPeerCertificate();
        let texto = '';
        res.on('data', trozo => { texto += trozo; });
        res.on('end', () => resolver({ texto, certificado }));
      }).on('error', rechazar);
    });
    assert.equal(cuerpo.texto, 'seguro=true');
    assert.match(cuerpo.certificado.subjectaltname, /IP Address:192\.168\.18\.6/);
    assert.match(cuerpo.certificado.subjectaltname, /DNS:EQUIPO-PRUEBA/);
    // Y con la validación normal (sin aceptar el aviso) falla: es autofirmado a propósito.
    await assert.rejects(new Promise((resolver, rechazar) => {
      https.get({ host: '127.0.0.1', port: puerto, path: '/' }, resolver).on('error', rechazar);
    }));
  } finally {
    await new Promise(resolver => servidor.close(resolver));
  }
});
