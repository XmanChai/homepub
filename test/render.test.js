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
});

test('bootstrap site is HTTP only, serves ACME and never references a certificate', () => {
  const conf = file('server/nginx/bootstrap/blog.example.com.conf');
  assert.match(conf, /listen 80;/);
  assert.doesNotMatch(conf, /listen 443/);
  assert.doesNotMatch(conf, /ssl_certificate/);
  assert.match(conf, /location \/\.well-known\/acme-challenge\//);
  assert.match(conf, /return 503/);
});

test('full site proxies to the tunnel port and redirects http to https', () => {
  const conf = file('server/nginx/sites/blog.example.com.conf');
  assert.match(conf, /server_name blog\.example\.com;/);
  assert.match(conf, /proxy_pass http:\/\/127\.0\.0\.1:18081;/);
  assert.match(conf, /ssl_certificate     \/etc\/nginx\/certs\/blog\.example\.com\.pem;/);
  assert.ok(conf.includes('return 301 https://$host$request_uri;'));
  assert.ok(conf.includes('proxy_set_header Connection $connection_upgrade;'));
});

test('acme script checks exit codes correctly and verifies the installed files', () => {
  const script = file('server/acme.sh');
  assert.doesNotMatch(script, /if ! "\$ACME"/);
  assert.match(script, /rc=0/);
  assert.match(script, /\|\| rc=\$\?/);
  assert.match(script, /if \[ "\$rc" -ne 0 \] && \[ "\$rc" -ne 2 \]/);
  assert.match(script, /certificate files missing after install-cert/);
});

test('server install is two-phase with rollback and stale-site cleanup', () => {
  const script = file('server/install.sh');
  assert.match(script, /NEED_CERTS=0/);
  assert.ok(script.includes('install_conf "$host" bootstrap'));
  assert.ok(script.includes('install_conf "$host" sites'));
  assert.match(script, /trap rollback ERR/);
  assert.match(script, /prune_removed_hosts/);
  assert.match(script, /nginx -t/);
  assert.match(script, /\.homepub-managed/);
});

test('client install refuses a placeholder token and backs up the unit', () => {
  const script = file('client/install.sh');
  assert.match(script, /grep -q "CHANGE_ME_TOKEN"/);
  assert.match(script, /exit 1/);
  assert.match(script, /HOMEPUB_FORCE/);
  assert.match(script, /UNIT_TARGET=\/etc\/systemd\/system\/frpc\.service/);
  assert.match(script, /cp -a "\$UNIT_TARGET"/);
  assert.match(script, /command -v frpc/);
});

test('frps snippet warns to put keys before the first table', () => {
  const snippet = file('server/frps-snippet.toml');
  assert.match(snippet, /before the first \[table\]/);
  assert.match(snippet, /proxyBindAddr = "127\.0\.0\.1"/);
  assert.match(snippet, /start = 18081, end = 18085/);
  const example = file('server/frps.toml.example');
  assert.match(example, /bindPort = 7000/);
});

test('ports ledger is valid JSON with stable ports', () => {
  const ledger = JSON.parse(plan.ledger.content);
  assert.equal(ledger.domain, 'example.com');
  assert.deepEqual(ledger.services.map((s) => [s.name, s.tunnelPort]), [['blog', 18081], ['cloud', 18082]]);
});