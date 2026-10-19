import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../src/config.js';
import { runDoctor } from '../src/doctor.js';
import { baseConfig } from './helpers.js';

const cfg = normalize(baseConfig());
const fakePort = (ok) => async () => ({ ok, ms: 3, error: ok ? undefined : 'ECONNREFUSED' });
const fakeDns = (addresses) => async (host, expected) => ({
  ok: addresses.includes(expected),
  addresses,
  expectedAddresses: [expected]
});
const fakeHttps = (ok, daysLeft = 60) => async () => ({ ok, status: ok ? 200 : 502, daysLeft, ms: 10 });

test('all green', async () => {
  const { rows, ok } = await runDoctor(cfg, {
    checkPortFn: fakePort(true),
    checkDnsFn: fakeDns([cfg.server.addr]),
    checkHttpsFn: fakeHttps(true)
  });
  assert.equal(ok, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].service, 'blog');
  assert.equal(rows[0].dns.ok, true);
});

test('dns pointing elsewhere is a failure', async () => {
  const { ok } = await runDoctor(cfg, {
    checkPortFn: fakePort(true),
    checkDnsFn: fakeDns(['198.51.100.99']),
    checkHttpsFn: fakeHttps(true)
  });
  assert.equal(ok, false);
});

test('a dead local port is a failure', async () => {
  const { rows, ok } = await runDoctor(cfg, {
    checkPortFn: fakePort(false),
    checkDnsFn: fakeDns([cfg.server.addr]),
    checkHttpsFn: fakeHttps(true)
  });
  assert.equal(ok, false);
  assert.match(rows[0].local.error, /ECONNREFUSED/);
});

test('a broken https endpoint is a failure', async () => {
  const { ok } = await runDoctor(cfg, {
    checkPortFn: fakePort(true),
    checkDnsFn: fakeDns([cfg.server.addr]),
    checkHttpsFn: fakeHttps(false)
  });
  assert.equal(ok, false);
});

test('an expired certificate is a failure even if the page responds', async () => {
  const { ok, rows } = await runDoctor(cfg, {
    checkPortFn: fakePort(true),
    checkDnsFn: fakeDns([cfg.server.addr]),
    checkHttpsFn: async () => ({ ok: false, status: 200, daysLeft: -4208, error: 'CERT_EXPIRED', ms: 5 })
  });
  assert.equal(ok, false);
  assert.equal(rows[0].https.daysLeft, -4208);
});
