import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isIntInRange, isPort } from './util.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const SERVICE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const fail = (path, message) => {
  throw new ConfigError(`${path}: ${message}`);
};

/** Load and validate a homepub.config.json file. */
export function loadConfig(file, { baseDir = process.cwd() } = {}) {
  const abs = resolve(baseDir, file);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read config file ${abs}: ${err.code ?? err.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${abs} is not valid JSON: ${err.message}`);
  }
  const cfg = normalize(raw);
  cfg.configPath = abs;
  cfg.baseDir = dirname(abs);
  return cfg;
}

/** Validate and fill defaults. Kept pure so it can be unit-tested. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('$', 'config must be a JSON object');
  }

  const domain = String(raw.domain ?? '').trim().toLowerCase();
  if (!domain) fail('domain', 'required, e.g. "example.com"');
  if (!DOMAIN.test(domain)) fail('domain', `"${domain}" is not a valid root domain`);

  const rawServer = raw.server;
  if (!rawServer || typeof rawServer !== 'object') fail('server', 'required object, e.g. { "addr": "203.0.113.10" }');
  const addr = String(rawServer.addr ?? '').trim();
  if (!addr) fail('server.addr', 'required: public address of your frps server');
  if (!HOST.test(addr)) fail('server.addr', `"${addr}" is not a valid hostname or IP address`);

  const server = {
    addr,
    port: rawServer.port ?? 7000,
    tokenEnv: rawServer.tokenEnv ?? 'FRP_TOKEN',
    bindAddr: rawServer.bindAddr ?? '127.0.0.1',
    frpsConfigPath: rawServer.frpsConfigPath ?? '/etc/frp/frps.toml'
  };
  if (!isPort(server.port)) fail('server.port', 'must be an integer between 1 and 65535');
  if (typeof server.tokenEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(server.tokenEnv)) {
    fail('server.tokenEnv', 'must be an environment variable name like "FRP_TOKEN"');
  }
  if (!HOST.test(server.bindAddr)) fail('server.bindAddr', 'must be a hostname or IP address');

  const tunnel = {
    portStart: raw.tunnel?.portStart ?? 18081,
    portEnd: raw.tunnel?.portEnd ?? 18099
  };
  if (!isPort(tunnel.portStart)) fail('tunnel.portStart', 'must be an integer between 1 and 65535');
  if (!isPort(tunnel.portEnd)) fail('tunnel.portEnd', 'must be an integer between 1 and 65535');
  if (tunnel.portStart > tunnel.portEnd) fail('tunnel', 'portStart must be <= portEnd');

  const rawPaths = raw.paths ?? {};
  const paths = {
    out: rawPaths.out ?? './out',
    frpcConfig: rawPaths.frpcConfig ?? '/etc/frp/frpc.toml',
    nginxConfDir: rawPaths.nginxConfDir ?? '/etc/nginx/conf.d',
    nginxCertsDir: rawPaths.nginxCertsDir ?? '/etc/nginx/certs',
    acmeHome: rawPaths.acmeHome ?? '/root/.acme.sh',
    acmeWebroot: rawPaths.acmeWebroot ?? '/var/www/acme',
    ledger: rawPaths.ledger ?? './ports.json'
  };
  for (const [key, value] of Object.entries(paths)) {
    if (typeof value !== 'string' || value.trim() === '') fail(`paths.${key}`, 'must be a non-empty string');
  }

  if (!Array.isArray(raw.services) || raw.services.length === 0) {
    fail('services', 'required: a non-empty array of services');
  }
  if (raw.services.length > tunnel.portEnd - tunnel.portStart + 1) {
    fail('services', `too many services (${raw.services.length}) for tunnel port range ${tunnel.portStart}-${tunnel.portEnd}`);
  }

  const seenNames = new Set();
  const seenSubdomains = new Set();
  const services = raw.services.map((item, index) => {
    const at = `services[${index}]`;
    if (!item || typeof item !== 'object') fail(at, 'must be an object');
    const name = String(item.name ?? '').trim();
    if (!name) fail(`${at}.name`, 'required, e.g. "blog"');
    if (!SERVICE_NAME.test(name)) fail(`${at}.name`, `"${name}" must be lowercase letters, digits and dashes (max 32)`);
    if (seenNames.has(name)) fail(`${at}.name`, `duplicate service name "${name}"`);
    seenNames.add(name);

    const sub = item.subdomain === undefined ? name : String(item.subdomain).trim();
    if (sub !== '' && !SERVICE_NAME.test(sub)) {
      fail(`${at}.subdomain`, `"${sub}" must be lowercase letters, digits and dashes, or "" for the apex domain`);
    }
    const host = sub ? `${sub}.${domain}` : domain;
    if (seenSubdomains.has(host)) fail(`${at}.subdomain`, `duplicate host "${host}"`);
    seenSubdomains.add(host);

    const localPort = item.localPort;
    if (!isPort(localPort)) fail(`${at}.localPort`, 'required integer between 1 and 65535');

    const localHost = item.localHost ?? '127.0.0.1';
    if (!HOST.test(String(localHost))) fail(`${at}.localHost`, 'must be a hostname or IP address');

    const healthPath = item.healthPath ?? '/';
    if (typeof healthPath !== 'string' || !healthPath.startsWith('/')) {
      fail(`${at}.healthPath`, 'must start with "/"');
    }

    const protocol = item.protocol ?? 'http';
    if (protocol !== 'http' && protocol !== 'https') fail(`${at}.protocol`, 'must be "http" or "https"');

    return {
      name,
      subdomain: sub,
      host,
      localHost,
      localPort,
      healthPath,
      protocol,
      note: typeof item.note === 'string' ? item.note : ''
    };
  });

  return { domain, server, tunnel, paths, services };
}