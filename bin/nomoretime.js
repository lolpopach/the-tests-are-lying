#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { formatReport, formatJson, colorEnabled } from '../src/report.js';
import { SEVERITY_ORDER } from '../src/rules/helpers.js';
import { RULES } from '../src/rules/index.js';

const HELP = `
  nomoretime -- pre-flight check for vibe-coded apps

  Usage
    npx nomoretime [path] [options]

  Options
    --json              machine-readable output
    --fail-on <level>   exit 1 at this severity or worse (default: high)
                        one of: critical, high, medium, never
    --only <ids>        run just these checks (comma separated)
    --skip <ids>        run everything except these checks
    --list              print every check and exit
    --no-color          plain text output
    -h, --help          this message
    -v, --version       print the version

  Silence one line with a trailing comment:
    const key = "sk-not-a-real-key"; // nomoretime-ignore
`;

function parseArgs(argv) {
  const options = { path: null, json: false, failOn: 'high', only: null, skip: [], color: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };

    if (arg === '--json') options.json = true;
    else if (arg === '--fail-on') options.failOn = next();
    else if (arg === '--only') options.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--skip') options.skip = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--no-color') options.color = false;
    else if (arg === '--color') options.color = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '-v' || arg === '--version') options.version = true;
    else if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    else if (options.path === null) options.path = arg;
    else fail(`unexpected argument: ${arg}`);
  }

  return options;
}

function fail(message) {
  process.stderr.write(`nomoretime: ${message}\n`);
  process.exit(2);
}

function version() {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    process.stdout.write(version() + '\n');
    return 0;
  }
  if (options.list) {
    for (const rule of RULES) process.stdout.write(`${rule.id.padEnd(30)} ${rule.title}\n`);
    return 0;
  }

  const validLevels = [...SEVERITY_ORDER, 'never'];
  if (!validLevels.includes(options.failOn)) {
    fail(`--fail-on must be one of: ${validLevels.join(', ')}`);
  }

  const known = new Set(RULES.map((r) => r.id));
  for (const id of [...(options.only || []), ...options.skip]) {
    if (!known.has(id)) fail(`unknown check: ${id} (try --list)`);
  }

  const root = resolve(options.path || process.cwd());
  const result = check(root, { only: options.only, skip: options.skip });

  if (options.json) {
    process.stdout.write(formatJson(result) + '\n');
  } else {
    const color = options.color === null ? colorEnabled() : options.color;
    const width = process.stdout.columns || 80;
    process.stdout.write(formatReport(result, { color, width }) + '\n');
  }

  if (options.failOn === 'never') return 0;
  const threshold = SEVERITY_ORDER.indexOf(options.failOn);
  const triggered = result.findings.some(
    (f) => SEVERITY_ORDER.indexOf(f.severity) <= threshold
  );
  return triggered ? 1 : 0;
}

process.exitCode = main();
