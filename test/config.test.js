import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, normalize } from '../src/config.js';
import { baseConfig } from './helpers.js';

test('fills sensible defaults', () => {
  const cfg = normalize(baseConfig());
  assert.equal(cfg.server.port, 7000);
  assert.equal(cfg.server.tokenEnv, 'FRP_TOKEN');
  assert.equal(cfg.server.bindAddr, '127.0.0.1');
  assert.equal(cfg.tunnel.portStart, 18081);
  assert.equal(cfg.services[0].host, 'blog.example.com');
  assert.equal(cfg.services[0].protocol, 'http');
  assert.equal(cfg.services[0].healthPath, '/');
  assert.equal(cfg.paths.acmeHome, '/root/.acme.sh');
});

test('supports the apex domain when subdomain is empty', () => {
  const cfg = normalize(baseConfig({
    services: [{ name: 'root', subdomain: '', localPort: 8080 }]
  }));
  assert.equal(cfg.services[0].host, 'example.com');
});

test('rejects an invalid domain', () => {
  assert.throws(() => normalize(baseConfig({ domain: 'not a domain' })), ConfigError);
  assert.throws(() => normalize(baseConfig({ domain: '' })), /domain: required/);
});

test('rejects duplicate service names and hosts', () => {
  const base = baseConfig();
  assert.throws(
    () => normalize({ ...base, services: [...base.services, { ...base.services[0] }] }),
    /duplicate service name/
  );
  assert.throws(
    () => normalize({ ...base, services: [...base.services, { name: 'other', subdomain: 'blog', localPort: 9000 }] }),
    /duplicate host/
  );
});

test('rejects bad ports, names and health paths', () => {
  const base = baseConfig();
  assert.throws(() => normalize({ ...base, services: [{ name: 'Blog', localPort: 8080 }] }), /lowercase/);
  assert.throws(() => normalize({ ...base, services: [{ name: 'blog', localPort: 0 }] }), /localPort/);
  assert.throws(() => normalize({ ...base, services: [{ name: 'blog', localPort: '8080' }] }), /localPort/);
  assert.throws(() => normalize({ ...base, services: [{ name: 'blog', localPort: 8080, healthPath: 'x' }] }), /healthPath/);
  assert.throws(() => normalize({ ...base, services: [{ name: 'blog', localPort: 8080, protocol: 'ftp' }] }), /protocol/);
});

test('rejects more services than the tunnel range can hold', () => {
  const services = Array.from({ length: 6 }, (_, i) => ({ name: 'svc' + i, localPort: 9000 + i }));
  assert.throws(() => normalize(baseConfig({ services })), /too many services/);
});

test('rejects a broken server block', () => {
  assert.throws(() => normalize(baseConfig({ server: undefined })), /server: required/);
  assert.throws(() => normalize(baseConfig({ server: { addr: 'http://x' } })), /server.addr/);
});
test('reports unknown keys instead of silently ignoring them', () => {
  const cfg = normalize({ ...baseConfig(), server: { addr: '203.0.113.10', bindAdr: '10.0.0.1' } });
  assert.match(cfg.warnings.join(' '), /server.bindAdr is not a known option/);
});

test('rejects paths that could inject shell commands', () => {
  const base = baseConfig();
  assert.throws(
    () => normalize({ ...base, paths: { nginxCertsDir: '/etc/nginx/certs; rm -rf /' } }),
    /may only contain letters, digits/
  );
  assert.throws(
    () => normalize({ ...base, paths: { out: '/tmp/ok/$(whoami)' } }),
    /may only contain letters, digits/
  );
});
