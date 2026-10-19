import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLedger, applyPlan, planDiff } from './apply.js';
import { ConfigError, loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { buildPlan } from './plan.js';
import { VERSION } from './version.js';

const DEFAULT_CONFIG = 'homepub.config.json';
const TOKEN_PLACEHOLDER = 'CHANGE_ME_TOKEN';
const USAGE = `homepub v${VERSION}

Publish self-hosted services to the internet with frp + nginx + ACME.

Usage:
  homepub <command> [options]

Commands:
  init [dir]            create a starter homepub.config.json
  plan                  show what would change (no writes, no network)
  apply                 write ./out (only files whose content changed)
  status                show the port ledger
  doctor                check local ports, DNS and public HTTPS endpoints
  help                  show this help

Options:
  --config <path>       config file (default: ./homepub.config.json)
  --out <dir>           output directory (default: paths.out from the config)
  --token <token>       frps auth token (default: \$FRP_TOKEN, else reuse out/client/frpc.toml)
  --ledger <path>       override paths.ledger (where ports.json is written/read)
  --force               rewrite every file even if unchanged
  --prune               delete generated files that no longer belong to the plan
  --json                machine-readable output (plan / status / doctor)
`;

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config' || arg === '--out' || arg === '--token' || arg === '--ledger') {
      const value = argv[i + 1];
      if (!value) throw new Error(arg + ' needs a value');
      flags[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--force' || arg === '--json' || arg === '--prune') {
      flags[arg.slice(2)] = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg.startsWith('-')) {
      throw new Error('unknown option: ' + arg);
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

const pad = (value, width) => {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
};

async function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return null;
  try {
    return JSON.parse(await readFile(ledgerPath, 'utf8'));
  } catch {
    return null;
  }
}

function printPortsTable(cfg, ports) {
  console.log('');
  console.log(pad('service', 14) + pad('public URL', 34) + pad('local', 24) + 'tunnel port');
  console.log('-'.repeat(90));
  for (const svc of cfg.services) {
    console.log(
      pad(svc.name, 14) + pad(svc.host, 34) + pad(svc.localHost + ':' + svc.localPort, 24) + '127.0.0.1:' + ports.get(svc.name)
    );
  }
}

function printFileList(title, paths) {
  if (paths.length === 0) return;
  console.log(title);
  for (const p of paths) console.log('  ' + p);
}

function printWarnings(cfg, plan) {
  for (const warning of cfg.warnings ?? []) console.log('warning: ' + warning);
  for (const warning of plan?.warnings ?? []) console.log('warning: ' + warning);
}

/** Token precedence: --token, env, then whatever is already in out/client/frpc.toml. */
async function resolveToken(args, cfg, outDir) {
  if (args.token) return args.token;
  const fromEnv = process.env[cfg.server.tokenEnv];
  if (fromEnv) return fromEnv;
  const existing = existsSync(join(outDir, 'client', 'frpc.toml'))
    ? await readFile(join(outDir, 'client', 'frpc.toml'), 'utf8')
    : '';
  const match = existing.match(/^auth\.token = "(.+)"$/m);
  if (match && match[1] !== TOKEN_PLACEHOLDER) return match[1];
  return undefined;
}

async function loadContext(args) {
  const cfg = loadConfig(args.config ?? DEFAULT_CONFIG);
  const outDir = args.out ? resolve(args.out) : resolve(cfg.baseDir, cfg.paths.out);
  const ledgerPath = args.ledger ? resolve(args.ledger) : resolve(cfg.baseDir, cfg.paths.ledger);
  const ledger = await readLedger(ledgerPath);
  const previousPorts = {};
  for (const item of ledger?.services ?? []) previousPorts[item.name] = item.tunnelPort;
  const token = await resolveToken(args, cfg, outDir);
  return { cfg, outDir, ledgerPath, ledger, token, previousPorts };
}

async function cmdInit(args) {
  const targetDir = resolve(args._[1] ?? '.');
  const target = join(targetDir, DEFAULT_CONFIG);
  if (existsSync(target)) {
    console.log('config already exists: ' + target);
    return 0;
  }
  const template = await readFile(fileURLToPath(new URL('../examples/homepub.config.json', import.meta.url)), 'utf8');
  await mkdir(targetDir, { recursive: true });
  await writeFile(target, template, 'utf8');
  console.log('created ' + target);
  console.log('next: edit domain / server.addr / services, then run "homepub plan"');
  return 0;
}

async function cmdPlan(args) {
  const { cfg, outDir, ledgerPath, token, previousPorts } = await loadContext(args);
  const plan = buildPlan(cfg, { version: VERSION, token, previousPorts });
  const diff = await planDiff(plan, outDir);

  if (args.json) {
    console.log(JSON.stringify({
      config: cfg.configPath,
      output: outDir,
      ledger: ledgerPath,
      ports: Object.fromEntries(plan.ports),
      create: diff.added,
      update: diff.changed,
      remove: diff.obsolete,
      warnings: [...(cfg.warnings ?? []), ...plan.warnings]
    }, null, 2));
    return 0;
  }

  console.log('config: ' + cfg.configPath);
  console.log('output: ' + outDir);
  console.log('ledger: ' + ledgerPath);
  printPortsTable(cfg, plan.ports);
  printFileList('create:', diff.added);
  printFileList('update:', diff.changed);
  printFileList('remove (apply --prune):', diff.obsolete);
  console.log('ledger: ' + (await readLedger(ledgerPath) ? 'unchanged-or-updated-on-apply' : 'create') + ' (' + ledgerPath + ')');
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.obsolete.length === 0) {
    console.log('no file changes');
  }
  printWarnings(cfg, plan);
  return 0;
}

async function cmdApply(args) {
  const { cfg, outDir, ledgerPath, token, previousPorts } = await loadContext(args);
  const plan = buildPlan(cfg, { version: VERSION, token, previousPorts });
  const result = await applyPlan(plan, outDir, { force: Boolean(args.force), prune: Boolean(args.prune) });
  const ledgerWritten = await applyLedger(plan, ledgerPath);

  console.log('wrote ' + result.written.length + ' file(s) to ' + outDir);
  console.log('ledger ' + (ledgerWritten ? 'updated: ' : 'unchanged: ') + ledgerPath);
  printFileList('created:', result.added);
  printFileList('updated:', result.changed);
  printFileList('removed:', result.removed);
  if (result.written.length === 0) console.log('nothing to do (already up to date)');
  if (result.obsolete.length > 0 && !args.prune) {
    printFileList('stale (run "homepub apply --prune" to delete):', result.obsolete);
  }
  printWarnings(cfg, plan);
  console.log('next: scp out/client to the home server, out/server to the public server');
  return 0;
}

async function cmdStatus(args) {
  let ledgerPath = resolve('./ports.json');
  let cfg = null;
  const configPath = args.config ?? (existsSync(DEFAULT_CONFIG) ? DEFAULT_CONFIG : null);
  if (configPath) {
    cfg = loadConfig(configPath);
    ledgerPath = resolve(cfg.baseDir, cfg.paths.ledger);
  } else if (existsSync(resolve('./ports.json'))) {
    cfg = null;
  } else {
    console.error('no homepub.config.json and no ./ports.json here; pass --config <path>');
    return 1;
  }
  const ledger = await readLedger(ledgerPath);
  if (!ledger) {
    console.error('no ledger found at ' + ledgerPath + ' (run "homepub apply" first)');
    return 1;
  }
  if (args.json) {
    console.log(JSON.stringify(ledger, null, 2));
    return 0;
  }
  console.log('domain: ' + ledger.domain + '  |  generated by homepub v' + ledger.version);
  if (cfg) console.log('config: ' + cfg.configPath);
  console.log('');
  console.log(pad('service', 14) + pad('public URL', 34) + 'tunnel port');
  console.log('-'.repeat(72));
  for (const item of ledger.services) {
    console.log(pad(item.name, 14) + pad(item.host, 34) + '127.0.0.1:' + item.tunnelPort);
  }
  return 0;
}

async function cmdDoctor(args) {
  const cfg = loadConfig(args.config ?? DEFAULT_CONFIG);
  const { rows, ok } = await runDoctor(cfg);
  if (args.json) {
    console.log(JSON.stringify({ ok, rows }, null, 2));
    return ok ? 0 : 1;
  }
  console.log(pad('service', 14) + pad('local port', 26) + pad('dns', 26) + 'https');
  console.log('-'.repeat(96));
  for (const row of rows) {
    const local = row.local.ok ? 'ok (' + row.local.ms + 'ms)' : 'FAIL ' + (row.local.error ?? '');
    const dnsText = row.dns.ok ? 'ok' : 'FAIL ' + (row.dns.addresses?.length ? 'points elsewhere' : 'unresolved');
    const https = row.https.ok
      ? row.https.status + ' (' + (row.https.daysLeft ?? '?') + 'd cert)'
      : 'FAIL ' + (row.https.error ?? row.https.status);
    console.log(pad(row.service, 14) + pad(local, 26) + pad(dnsText, 26) + https);
  }
  console.log('');
  console.log(ok ? 'all checks passed' : 'some checks failed - see above');
  return ok ? 0 : 1;
}

export async function main(argv) {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error('run "homepub help"');
    return 1;
  }
  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  const command = flags._[0] ?? 'help';
  if (command === 'help' || flags.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    switch (command) {
      case 'init': return await cmdInit(flags);
      case 'plan': return await cmdPlan(flags);
      case 'apply': return await cmdApply(flags);
      case 'status': return await cmdStatus(flags);
      case 'doctor': return await cmdDoctor(flags);
      default:
        console.error('unknown command: ' + command);
        console.error('run "homepub help"');
        return 1;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('config error: ' + err.message);
      return 1;
    }
    throw err;
  }
}