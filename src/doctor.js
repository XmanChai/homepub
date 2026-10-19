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

/** Resolve A/AAAA records; falls back to the OS resolver for names like "localhost". */
export async function resolveIps(host) {
  const found = new Set();
  for (const lookup of [dns.resolve4, dns.resolve6]) {
    try {
      for (const ip of await lookup(host)) found.add(ip);
    } catch {
      /* try the next resolver */
    }
  }
  if (found.size === 0) {
    try {
      const { address } = await dns.lookup(host);
      if (address) found.add(address);
    } catch {
      /* unresolvable */
    }
  }
  return [...found];
}

/** The host must resolve to at least one address of the frps server. */
export async function checkDns(host, expected) {
  const addresses = await resolveIps(host);
  const expectedAddresses = await resolveIps(expected);
  const ok = addresses.length > 0 && expectedAddresses.length > 0 &&
    addresses.some((ip) => expectedAddresses.includes(ip));
  return { ok, addresses, expectedAddresses };
}

function probe(host, path, rejectUnauthorized, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request(
      {
        host,
        port: 443,
        path,
        method: 'GET',
        servername: host,
        rejectUnauthorized,
        timeout: timeoutMs,
        headers: { 'user-agent': 'homepub-doctor' }
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
          /* certificate details are best-effort */
        }
        res.resume();
        resolve({
          ok: res.statusCode > 0 && res.statusCode < 400,
          status: res.statusCode,
          daysLeft,
          issuer,
          ms: Date.now() - started
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout', ms: Date.now() - started });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message, ms: Date.now() - started }));
    req.end();
  });
}

/**
 * Two probes: one with full certificate validation (the one that decides "ok"),
 * one permissive (only to read expiry/issuer). Expired or self-signed certs fail.
 */
export async function checkHttps(host, path = '/', timeoutMs = 8000) {
  const [secure, detail] = await Promise.all([
    probe(host, path, true, timeoutMs),
    probe(host, path, false, timeoutMs)
  ]);
  const info = detail.daysLeft !== null ? detail : secure;
  const expired = info.daysLeft !== null && info.daysLeft <= 0;
  return {
    ok: secure.ok && !expired,
    status: secure.status ?? info.status,
    daysLeft: info.daysLeft ?? null,
    issuer: info.issuer ?? null,
    error: secure.error ?? (expired ? 'CERT_EXPIRED' : undefined),
    ms: secure.ms
  };
}

/** Run every check; returns rows plus an overall ok flag. */
export async function runDoctor(cfg, { checkPortFn = checkPort, checkDnsFn = checkDns, checkHttpsFn = checkHttps } = {}) {
  const rows = [];
  for (const svc of cfg.services) {
    const local = await checkPortFn(svc.localHost, svc.localPort);
    const dnsResult = await checkDnsFn(svc.host, cfg.server.addr);
    const httpsResult = await checkHttpsFn(svc.host, svc.healthPath);
    rows.push({ service: svc.name, host: svc.host, local, dns: dnsResult, https: httpsResult });
  }
  const ok = rows.every((row) => row.local.ok && row.https.ok && row.dns.ok);
  return { rows, ok };
}
