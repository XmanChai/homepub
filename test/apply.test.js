import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyLedger, applyPlan, planDiff } from '../src/apply.js';
import { normalize } from '../src/config.js';
import { buildPlan } from '../src/plan.js';
import { baseConfig, tmpDir } from './helpers.js';

const planFor = (config, version = '0.1.0') => buildPlan(normalize(config), { version, token: 'tok' });

test('apply writes files and is idempotent', async () => {
  const plan = planFor(baseConfig());
  const out = tmpDir();

  const first = await applyPlan(plan, out);
  assert.equal(first.written.length, plan.files.size);
  assert.match(readFileSync(join(out, 'ports.md'), 'utf8'), /Port ledger/);

  const second = await applyPlan(plan, out);
  assert.equal(second.written.length, 0);
  assert.equal(second.unchanged.length, plan.files.size);

  const ledgerPath = join(out, 'ports.json');
  assert.equal(await applyLedger(plan, ledgerPath), true);
  assert.equal(await applyLedger(plan, ledgerPath), false);
});

test('changing one local port only rewrites the files that mention it', async () => {
  const out = tmpDir();
  await applyPlan(planFor(baseConfig()), out);
  const after = planFor(baseConfig({
    services: [
      { name: 'blog', subdomain: 'blog', localPort: 8091 },
      { name: 'cloud', subdomain: 'nc', localPort: 8080, healthPath: '/status.php' }
    ]
  }));
  const diff = await planDiff(after, out);
  assert.deepEqual(diff.changed.sort(), ['client/frpc.toml', 'ports.md']);
  assert.deepEqual(diff.added, []);
});

test('removed services are reported as obsolete and pruned on demand', async () => {
  const out = tmpDir();
  const before = planFor(baseConfig());
  await applyPlan(before, out);
  assert.ok(before.files.has('server/nginx/sites/blog.example.com.conf'));

  const after = planFor(baseConfig({
    services: [
      { name: 'shop', subdomain: 'shop', localPort: 8090 },
      { name: 'cloud', subdomain: 'nc', localPort: 8080, healthPath: '/status.php' }
    ]
  }));
  const diff = await planDiff(after, out);
  assert.ok(diff.obsolete.includes('server/nginx/sites/blog.example.com.conf'));
  assert.ok(diff.obsolete.includes('server/nginx/bootstrap/blog.example.com.conf'));

  const result = await applyPlan(after, out, { prune: true });
  assert.ok(result.removed.includes('server/nginx/sites/blog.example.com.conf'));
  assert.throws(() => readFileSync(join(out, 'server/nginx/sites/blog.example.com.conf')));
});

test('obsolete detection never touches files it did not generate', async () => {
  const out = tmpDir();
  await applyPlan(planFor(baseConfig()), out);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(out, 'server/nginx/sites'), { recursive: true });
  writeFileSync(join(out, 'server/nginx/sites/handwritten.conf'), 'server { listen 80; }\n');
  const diff = await planDiff(planFor(baseConfig()), out);
  assert.ok(!diff.obsolete.includes('server/nginx/sites/handwritten.conf'));
});
