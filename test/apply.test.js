import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyLedger, applyPlan, planDiff } from '../src/apply.js';
import { normalize } from '../src/config.js';
import { buildPlan } from '../src/plan.js';
import { baseConfig, tmpDir } from './helpers.js';

test('apply writes files and is idempotent', async () => {
  const cfg = normalize(baseConfig());
  const plan = buildPlan(cfg, { version: '0.1.0', token: 'tok' });
  const out = tmpDir();

  const first = await applyPlan(plan, out);
  assert.equal(first.written.length, plan.files.size);
  assert.match(readFileSync(join(out, 'ports.md'), 'utf8'), /Port ledger/);

  const second = await applyPlan(plan, out);
  assert.equal(second.written.length, 0);
  assert.equal(second.unchanged.length, plan.files.size);

  const ledgerPath = join(out, 'ports.json');
  assert.equal(await applyLedger(plan, ledgerPath), true);
  assert.equal(await applyLedger(plan, ledgerPath), false, 'ledger write should be idempotent');
});

test('changing one local port only rewrites the files that mention it', async () => {
  const out = tmpDir();
  await applyPlan(buildPlan(normalize(baseConfig()), { version: '0.1.0', token: 'tok' }), out);

  const after = buildPlan(
    normalize(baseConfig({
      services: [
        { name: 'blog', subdomain: 'blog', localPort: 8091 },
        { name: 'cloud', subdomain: 'nc', localPort: 8080, healthPath: '/status.php' }
      ]
    })),
    { version: '0.1.0', token: 'tok' }
  );
  const diff = await planDiff(after, out);
  // nginx proxies to the tunnel port, so the nginx config stays the same
  assert.deepEqual(diff.changed.sort(), ['client/frpc.toml', 'ports.md']);
  assert.deepEqual(diff.added, []);
});