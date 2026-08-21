#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect } from '../src/index.js';
import { formatReport, formatJson, formatReply, colorEnabled } from '../src/report.js';
import { LEVEL_ORDER } from '../src/rules/helpers.js';
import { RULES } from '../src/rules/index.js';

const HELP = `
  the-tests-are-lying -- did this diff fix the code, or just the check?

  Usage
    npx the-tests-are-lying [options]

  What it reads
    (default)           staged changes -- the moment the claim gets made
    --unstaged          the working tree
    --head              everything since the last commit
    --range <a..b>      any git range, e.g. main..HEAD

  Options
    --reply             print the message to send back to the agent
    --json              machine-readable, includes the reply text
    --fail-on <level>   exit 1 at this level or worse (default: muted)
                        one of: lying, muted, looser, never
    --only <ids>        run just these checks (comma separated)
    --skip <ids>        run everything except these
    --list              print every check and exit
    -C <dir>            run in this directory
    --no-color          plain text
    -h, --help          this message
    -v, --version       print the version

  Sign off on a deliberate weakening with a trailing comment:
    it.skip('flaky on CI, see #412', ...) // tests-are-lying-ignore
`;

function fail(message) {
  process.stderr.write(`the-tests-are-lying: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    source: 'staged', range: null, json: false, reply: false,
    failOn: 'muted', only: null, skip: [], color: null, cwd: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };

    if (arg === '--unstaged') options.source = 'unstaged';
    else if (arg === '--head') options.source = 'head';
    else if (arg === '--staged' || arg === '--cached') options.source = 'staged';
    else if (arg === '--range') options.range = next();
    else if (arg === '--json') options.json = true;
    else if (arg === '--reply') options.reply = true;
    else if (arg === '--fail-on') options.failOn = next();
    else if (arg === '--only') options.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--skip') options.skip = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '-C') options.cwd = next();
    else if (arg === '--no-color') options.color = false;
    else if (arg === '--color') options.color = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '-v' || arg === '--version') options.version = true;
    else if (arg.startsWith('-')) fail(`unknown option: ${arg}`);
    else if (!options.range) options.range = arg;
    else fail(`unexpected argument: ${arg}`);
  }
  return options;
}

function version() {
  const pkg = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(readFileSync(pkg, 'utf8')).version;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) { process.stdout.write(HELP); return 0; }
  if (options.version) { process.stdout.write(version() + '\n'); return 0; }
  if (options.list) {
    for (const rule of RULES) process.stdout.write(`${rule.id.padEnd(26)} ${rule.title}\n`);
    return 0;
  }

  const levels = [...LEVEL_ORDER, 'never'];
  if (!levels.includes(options.failOn)) fail(`--fail-on must be one of: ${levels.join(', ')}`);

  const known = new Set(RULES.map((r) => r.id));
  for (const id of [...(options.only || []), ...options.skip]) {
    if (!known.has(id)) fail(`unknown check: ${id} (try --list)`);
  }

  const cwd = resolve(options.cwd || process.cwd());
  let result;
  try {
    result = inspect(cwd, {
      source: options.source,
      range: options.range,
      only: options.only,
      skip: options.skip,
    });
  } catch (err) {
    fail(`could not read the diff -- is this a git repository?\n  ${err.message.trim().split('\n')[0]}`);
  }

  if (options.json) {
    process.stdout.write(formatJson(result) + '\n');
  } else if (options.reply) {
    process.stdout.write(formatReply(result) + '\n');
  } else {
    const color = options.color === null ? colorEnabled() : options.color;
    process.stdout.write(formatReport(result, { color, width: process.stdout.columns || 80 }) + '\n');
  }

  if (options.failOn === 'never') return 0;
  const threshold = LEVEL_ORDER.indexOf(options.failOn);
  return result.findings.some((f) => LEVEL_ORDER.indexOf(f.level) <= threshold) ? 1 : 0;
}

process.exitCode = main();
