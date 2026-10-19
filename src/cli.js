import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLedger, applyPlan, planDiff } from './apply.js';
import { ConfigError, loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { buildPlan } from './plan.js';
import { VERSION } from './version.js';

const DEFAULT_CONFIG = 'homepub.config.json';
const USAGE = `homepub v${VERSION}

Publish self-hosted services to the internet with frp + nginx + ACME.

Usage:
  homepub <command> [options]

Commands:
  init [dir]            create a starter homepub.config.json
  plan                  show what would change (no writes, no network)
  apply                 write ./out (only files whose content changed)
  status                show the port ledger from ./out/ports.json
  doctor                check local ports, DNS and public HTTPS endpoints
  help                  show this help

Options:
  --config <path>       config file (default: ./homepub.config.json)
  --out <dir>           output directory (default: ./out)
  --token <token>       frps auth token (default: $FRP_TOKEN)
  --force               rewrite every file even if unchanged
  --json                machine-readable output (status / doctor)
`;

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config' || arg === '--out' || arg === '--token') {
      const value = argv[i + 1];
      if (!value) throw new Error(arg + ' needs a value');
      flags[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--force' || arg === '--json') {
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

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function printPortsTable(cfg, ports) {
  console.log('');
  console.log(pad('service', 14) + pad('public URL', 34) + pad('local', 24) + 'tunnel port');
  console.log('-'.repeat(90));
  for (const svc of cfg.services) {
    console.log(
      pad(svc.name, 14) +
      pad(svc.host, 34) +
      pad(svc.localHost + ':' + svc.localPort, 24) +
      '127.0.0.1:' + ports.get(svc.name)
    );
  }
}

function printFileList(title, paths) {
  if (paths.length === 0) return;
  console.log(title);
  for (const p of paths) console.log('  ' + p);
}

async function readLedger(ledgerPath) {
  if (!existsSync(ledgerPath)) return null;
  try {
    return JSON.parse(await readFile(ledgerPath, 'utf8'));
  } catch {
    return null;
  }
}

async function cmdInit(args) {
  const targetDir = resolve(args._[1] ?? '.');
  const target = join(targetDir, DEFAULT_CONFIG);
  if (existsSync(target)) {
    console.log('config already exists: ' + target);
    return 0;
  }
  const template = await readFile(fileURLToPath(new URL('../examples/homepub.config.json', import.meta.url)), 'utf8');
  await writeFile(target, template, 'utf8');
  console.log('created ' + target);
  console.log('next: edit domain / server.addr / services, then run "homepub plan"');
  return 0;
}

async function cmdPlan(args) {
  const cfg = loadConfig(args.config ?? DEFAULT_CONFIG);
  const outDir = args.out ? resolve(args.out) : resolve(cfg.baseDir, cfg.paths.out);
  const ledgerPath = resolve(cfg.baseDir, cfg.paths.ledger);
  const ledger = await readLedger(ledgerPath);
  const previousPorts = {};
  for (const item of ledger?.services ?? []) previousPorts[item.name] = item.tunnelPort;

  const token = args.token ?? process.env[cfg.server.tokenEnv];
  const plan = buildPlan(cfg, { version: VERSION, token, previousPorts });
  const diff = await planDiff(plan, outDir);

  console.log('config: ' + cfg.configPath);
  console.log('output: ' + outDir);
  console.log('ledger: ' + ledgerPath);
  printPortsTable(cfg, plan.ports);
  printFileList('create:', diff.added);
  printFileList('update:', diff.changed);
  if (diff.added.length === 0 && diff.changed.length === 0) console.log('no changes');
  for (const warning of plan.warnings) console.log('warning: ' + warning);
  return 0;
}

async function cmdApply(args) {
  const cfg = loadConfig(args.config ?? DEFAULT_CONFIG);
  const outDir = args.out ? resolve(args.out) : resolve(cfg.baseDir, cfg.paths.out);
  const ledgerPath = resolve(cfg.baseDir, cfg.paths.ledger);
  const ledger = await readLedger(ledgerPath);
  const previousPorts = {};
  for (const item of ledger?.services ?? []) previousPorts[item.name] = item.tunnelPort;

  const token = args.token ?? process.env[cfg.server.tokenEnv];
  const plan = buildPlan(cfg, { version: VERSION, token, previousPorts });
  const result = await applyPlan(plan, outDir, { force: Boolean(args.force) });
  const ledgerWritten = await applyLedger(plan, ledgerPath);

  console.log('wrote ' + result.written.length + ' file(s) to ' + outDir);
  console.log('ledger ' + (ledgerWritten ? 'updated: ' : 'unchanged: ') + ledgerPath);
  printFileList('created:', result.added);
  printFileList('updated:', result.changed);
  if (result.written.length === 0) console.log('nothing to do (already up to date)');
  for (const warning of plan.warnings) console.log('warning: ' + warning);
  console.log('next: scp out/client to the home server, out/server to the public server');
  return 0;
}

async function cmdStatus(args) {
  let ledgerPath = resolve('./ports.json');
  if (args.config) {
    const cfg = loadConfig(args.config);
    ledgerPath = resolve(cfg.baseDir, cfg.paths.ledger);
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
  console.log('-'.repeat(90));
  for (const row of rows) {
    const local = row.local.ok ? 'ok (' + row.local.ms + 'ms)' : 'FAIL ' + (row.local.error ?? '');
    const dnsText = row.dns.ok ? 'ok' : (row.dns.addresses?.length ? 'points elsewhere' : 'FAIL ' + (row.dns.error ?? ''));
    const https = row.https.ok
      ? row.https.status + ' (' + (row.https.daysLeft ?? '?') + 'd cert)'
      : 'FAIL ' + (row.https.error ?? row.https.status);
    console.log(pad(row.service, 14) + pad(local, 26) + pad(dnsText, 26) + https);
  }
  console.log('');
  console.log(ok ? 'all checks passed' : 'some checks failed — see above');
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