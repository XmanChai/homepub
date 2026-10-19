import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sortFiles } from './util.js';

export async function readTextFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Compare the in-memory plan with what is already on disk. */
export async function planDiff(plan, outDir) {
  const added = [];
  const changed = [];
  const unchanged = [];
  for (const [rel, file] of sortFiles(plan.files)) {
    const existing = await readTextFile(join(outDir, rel));
    if (existing === null) added.push(rel);
    else if (existing !== file.content) changed.push(rel);
    else unchanged.push(rel);
  }
  return { added, changed, unchanged };
}

/** Write the port ledger (kept outside ./out so deleting ./out never reshuffles ports). */
export async function applyLedger(plan, ledgerPath) {
  const existing = await readTextFile(ledgerPath);
  if (existing === plan.ledger.content) return false;
  await mkdir(dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, plan.ledger.content, 'utf8');
  return true;
}

/** Write the plan to disk. Only touches files whose content changed. */
export async function applyPlan(plan, outDir, { force = false } = {}) {
  const diff = await planDiff(plan, outDir);
  const targets = new Set(force ? [...plan.files.keys()] : [...diff.added, ...diff.changed]);
  for (const [rel, file] of sortFiles(plan.files)) {
    if (!targets.has(rel)) continue;
    const abs = join(outDir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, 'utf8');
    if (process.platform !== 'win32') {
      await chmod(abs, file.mode);
    }
  }
  return { ...diff, written: [...targets].sort() };
}