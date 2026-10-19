import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../src/config.js';
import { buildPlan } from '../src/plan.js';
import { baseConfig } from './helpers.js';

const cfg = normalize(baseConfig());
const plan = buildPlan(cfg, { version: '0.1.0', token: 'tok' });
const file = (path) => plan.files.get(path).content;

test('frpc.toml maps every service to its tunnel port', () => {
  const toml = file('client/frpc.toml');
  assert.match(toml, /serverAddr = "203.0.113.10"/);
  assert.match(toml, /auth.token = "tok"/);
  assert.match(toml, /name = "blog"[\s\S]*remotePort = 18081/);
  assert.match(toml, /name = "cloud"[\s\S]*remotePort = 18082/);
  assert.match(toml, /localPort = 8080/);
});

test('nginx config proxies to the tunnel port and serves ACME challenges', () => {
  const conf = file('server/nginx/blog.example.com.conf');
  assert.match(conf, /server_name blog\.example\.com;/);
  assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:18081;/);
  assert.match(conf, /location \/\.well-known\/acme-challenge\//);
  assert.match(conf, /ssl_certificate     \/etc\/nginx\/certs\/blog\.example\.com\.pem;/);
});

test('acme script covers every host', () => {
  const script = file('server/acme.sh');
  assert.match(script, /issue blog\.example\.com/);
  assert.match(script, /issue nc\.example\.com/);
  assert.match(script, /--reloadcmd "systemctl reload nginx"/);
});

test('install scripts back up before overwriting', () => {
  const server = file('server/install.sh');
  assert.match(server, /cp -a "\$target" "\$target\.bak\.\$TS"/);
  assert.match(server, /nginx -t/);
  assert.match(server, /systemctl reload nginx/);
  const client = file('client/install.sh');
  assert.match(client, /cp -a "\$TARGET" "\$TARGET\.bak\.\$TS"/);
  assert.match(client, /install -m 600/);
});

test('frps snippet locks tunnel ports to loopback', () => {
  const snippet = file('server/frps-snippet.toml');
  assert.match(snippet, /proxyBindAddr = "127\.0\.0\.1"/);
  assert.match(snippet, /start = 18081, end = 18085/);
});

test('ports ledger is valid JSON with stable ports', () => {
  const ledger = JSON.parse(plan.ledger.content);
  assert.equal(ledger.domain, 'example.com');
  assert.deepEqual(ledger.services.map((s) => [s.name, s.tunnelPort]), [['blog', 18081], ['cloud', 18082]]);
});