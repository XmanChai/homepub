import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

const DAY_MS = 24 * 60 * 60 * 1000;

export function checkPort(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    const done = (ok, error) => {
      socket.destroy();
      resolve({ ok, ms: Date.now() - started, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.code || err.message));
    socket.connect(port, host);
  });
}

export async function checkDns(host) {
  try {
    const addresses = await dns.resolve4(host);
    return { ok: addresses.length > 0, addresses };
  } catch (err) {
    return { ok: false, addresses: [], error: err.code || err.message };
  }
}

export function checkHttps(host, path = '/', timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve({ ...value, ms: Date.now() - started });
    };
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method: 'GET',
        servername: host,
        rejectUnauthorized: false,
        headers: { 'user-agent': 'homepub-doctor' },
        timeout: timeoutMs
      },
      (res) => {
        let daysLeft = null;
        let issuer = null;
        try {
          const cert = res.socket.getPeerCertificate();
          if (cert && cert.valid_to) {
            const expires = new Date(cert.valid_to);
            if (!Number.isNaN(expires.getTime())) daysLeft = Math.floor((expires - Date.now()) / DAY_MS);
          }
          issuer = cert?.issuer?.O ?? null;
        } catch {
          /* certificate info is best-effort */
        }
        res.resume();
        finish({ ok: res.statusCode > 0 && res.statusCode < 400, status: res.statusCode, daysLeft, issuer });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => finish({ ok: false, error: err.code || err.message }));
    req.end();
  });
}

/** Run every check; returns rows plus an overall ok flag. */
export async function runDoctor(cfg, { checkPortFn = checkPort, checkDnsFn = checkDns, checkHttpsFn = checkHttps } = {}) {
  const rows = [];
  for (const svc of cfg.services) {
    const local = await checkPortFn(svc.localHost, svc.localPort);
    const dnsResult = await checkDnsFn(svc.host);
    const dnsOk = dnsResult.ok && dnsResult.addresses.includes(cfg.server.addr);
    const httpsResult = await checkHttpsFn(svc.host, svc.healthPath);
    rows.push({
      service: svc.name,
      host: svc.host,
      local,
      dns: { ...dnsResult, ok: dnsOk },
      https: httpsResult
    });
  }
  const ok = rows.every((row) => row.local.ok && row.https.ok && row.dns.ok);
  return { rows, ok };
}
