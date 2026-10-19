import { ConfigError } from './config.js';
import {
  renderAcme, renderClientInstall, renderFrpc, renderFrpcService, renderFrpsSnippet,
  renderMapConf, renderNginx, renderPortsJson, renderPortsMarkdown, renderServerInstall
} from './render.js';
import { isIntInRange } from './util.js';

/**
 * Assign tunnel ports. Existing assignments (from out/ports.json) win, so adding
 * a new service never moves an existing one. New services get the first free port.
 */
export function assignPorts(cfg, previous = {}) {
  const { portStart, portEnd } = cfg.tunnel;
  const used = new Set();
  const assigned = new Map();

  for (const svc of cfg.services) {
    const prev = previous[svc.name];
    if (isIntInRange(prev, portStart, portEnd) && !used.has(prev)) {
      used.add(prev);
      assigned.set(svc.name, prev);
    }
  }

  let cursor = portStart;
  for (const svc of cfg.services) {
    if (assigned.has(svc.name)) continue;
    while (used.has(cursor)) cursor += 1;
    if (cursor > portEnd) {
      throw new ConfigError(`tunnel port range ${portStart}-${portEnd} is exhausted; widen tunnel.portStart/portEnd`);
    }
    used.add(cursor);
    assigned.set(svc.name, cursor);
  }
  return assigned;
}

/** Build every output file in memory. Pure: no writes, no network. */
export function buildPlan(cfg, { version = '0.1.0', token, previousPorts = {} } = {}) {
  const ports = assignPorts(cfg, previousPorts);
  const files = new Map();
  const add = (path, content, mode = 0o644) => files.set(path, { content, mode });

  add('client/frpc.toml', renderFrpc(cfg, ports, { token, version }), 0o600);
  add('client/frpc.service', renderFrpcService(version));
  add('client/install.sh', renderClientInstall(version), 0o755);

  add('server/nginx/00-homepub-map.conf', renderMapConf(version));
  for (const svc of cfg.services) {
    add(`server/nginx/${svc.host}.conf`, renderNginx(cfg, svc, ports.get(svc.name), version));
  }
  add('server/acme.sh', renderAcme(cfg, version), 0o755);
  add('server/install.sh', renderServerInstall(cfg, version), 0o755);
  add('server/frps-snippet.toml', renderFrpsSnippet(cfg, version));

  add('ports.md', renderPortsMarkdown(cfg, ports, version));

  const warnings = [];
  if (!token || token === 'CHANGE_ME_TOKEN') {
    warnings.push('frpc.toml uses CHANGE_ME_TOKEN; run "homepub apply --token \"$FRP_TOKEN\"" (or export FRP_TOKEN=...) before installing.');
  }
  return {
    files,
    ports,
    warnings,
    version,
    ledger: { path: cfg.paths.ledger, content: renderPortsJson(cfg, ports, version) }
  };
}