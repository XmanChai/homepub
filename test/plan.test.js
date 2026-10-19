import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, normalize } from '../src/config.js';
import { assignPorts, buildPlan } from '../src/plan.js';
import { baseConfig } from './helpers.js';

test('allocates tunnel ports in config order', () => {
  const cfg = normalize(baseConfig());
  const ports = assignPorts(cfg);
  assert.equal(ports.get('blog'), 18081);
  assert.equal(ports.get('cloud'), 18082);
});

test('keeps previous assignments so adding a service does not move others', () => {
  const cfg = normalize(baseConfig({
    services: [
      { name: 'blog', localPort: 8090 },
      { name: 'new', localPort: 9000 },
      { name: 'cloud', localPort: 8080 }
    ]
  }));
  const ports = assignPorts(cfg, { blog: 18083, cloud: 18081 });
  assert.equal(ports.get('blog'), 18083);
  assert.equal(ports.get('cloud'), 18081);
  assert.equal(ports.get('new'), 18082);
});

test('refuses to build when the tunnel range is too small', () => {
  const two = {
    tunnel: { portStart: 18081, portEnd: 18081 },
    services: [
      { name: 'a', localPort: 8001 },
      { name: 'b', localPort: 8002 }
    ]
  };
  assert.throws(() => normalize(baseConfig(two)), /too many services/);
});

test('builds every expected file deterministically', () => {
  const cfg = normalize(baseConfig());
  const first = buildPlan(cfg, { version: '9.9.9' });
  const second = buildPlan(cfg, { version: '9.9.9' });
  assert.deepEqual([...first.files.keys()].sort(), [
    'client/frpc.service',
    'client/frpc.toml',
    'client/install.sh',
    'ports.md',
    'server/acme.sh',
    'server/frps-snippet.toml',
    'server/frps.toml.example',
    'server/install.sh',
    'server/nginx/00-homepub-map.conf',
    'server/nginx/bootstrap/blog.example.com.conf',
    'server/nginx/bootstrap/nc.example.com.conf',
    'server/nginx/sites/blog.example.com.conf',
    'server/nginx/sites/nc.example.com.conf'
  ]);
  for (const [path, file] of first.files) {
    assert.equal(file.content, second.files.get(path).content, path + ' should be deterministic');
  }
  const ledger = JSON.parse(first.ledger.content);
  assert.deepEqual(ledger.services.map((s) => [s.name, s.tunnelPort]), [['blog', 18081], ['cloud', 18082]]);
  assert.equal(first.ledger.path, './ports.json');
});

test('keeps ports stable across runs when previousPorts is supplied', () => {
  const cfg = normalize(baseConfig());
  const plan = buildPlan(cfg, { version: '0.1.0', previousPorts: { blog: 18082, cloud: 18081 } });
  assert.equal(plan.ports.get('blog'), 18082);
  assert.equal(plan.ports.get('cloud'), 18081);
});

test('warns when the token is missing', () => {
  const cfg = normalize(baseConfig());
  const plan = buildPlan(cfg, { version: '0.1.0' });
  assert.match(plan.warnings.join(' '), /CHANGE_ME_TOKEN/);
  const withToken = buildPlan(cfg, { version: '0.1.0', token: 'secret-token' });
  assert.equal(withToken.warnings.length, 0);
});

test('exhausted ranges are reported as ConfigError, not a crash', () => {
  const cfg = normalize(baseConfig());
  const forced = {
    ...cfg,
    tunnel: { portStart: 9000, portEnd: 9001 },
    services: [
      { ...cfg.services[0], name: 'a' },
      { ...cfg.services[1], name: 'b' },
      { ...cfg.services[0], name: 'c' }
    ]
  };
  assert.throws(() => assignPorts(forced), ConfigError);
});
