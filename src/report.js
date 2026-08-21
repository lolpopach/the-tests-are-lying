import { SEVERITY_ORDER } from './rules/helpers.js';

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  green: '\u001b[32m',
  grey: '\u001b[90m',
};

/** Honour NO_COLOR and pipes; a report piped into a file should stay readable. */
export function makePainter(enabled) {
  if (!enabled) {
    const identity = (s) => s;
    return new Proxy({}, { get: () => identity });
  }
  return new Proxy({}, {
    get: (_, key) => (s) => (ANSI[key] ? ANSI[key] + s + ANSI.reset : s),
  });
}

export function colorEnabled(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}

const SEVERITY_STYLE = {
  critical: { label: 'CRITICAL', color: 'red', mark: '!' },
  high: { label: 'HIGH', color: 'yellow', mark: '*' },
  medium: { label: 'MEDIUM', color: 'blue', mark: '-' },
};

/** Wrap text to a column, prefixing every line with the same indent. */
function wrap(text, width, indent) {
  const limit = Math.max(24, width - indent.length);
  const lines = [];
  let current = '';

  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > limit) {
      lines.push(indent + current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

function truncate(text, max) {
  const s = String(text);
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}

/** Render the full human-readable report as a string. */
export function formatReport(result, { color = true, width = 80 } = {}) {
  const c = makePainter(color);
  const { findings, counts, stats, errors } = result;
  const out = [];
  const w = Math.min(Math.max(width, 60), 100);

  out.push('');
  out.push(
    '  ' + c.bold('nomoretime') + '  ' +
    c.grey(`${stats.filesScanned} files checked in ${(stats.durationMs / 1000).toFixed(1)}s`)
  );
  out.push('');

  if (findings.length === 0) {
    out.push('  ' + c.green('Nothing to fix.') + ' ' + c.grey(`${stats.rulesRun} checks passed.`));
    out.push('');
    if (errors.length) out.push(...renderErrors(errors, c));
    return out.join('\n');
  }

  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;

    const style = SEVERITY_STYLE[severity];
    out.push('  ' + c[style.color](c.bold(style.label)) + '  ' + c.grey(String(group.length)));
    out.push('  ' + c.grey('-'.repeat(w - 2)));
    out.push('');

    for (const f of group) {
      out.push('  ' + c[style.color](style.mark) + '  ' + c.bold(f.message));
      out.push('     ' + c.grey(`${f.file}:${f.line}`) + c.grey('  ·  ') + c.grey(f.ruleId));
      out.push('');

      if (f.snippet) {
        out.push('     ' + c.dim(truncate(f.snippet, w - 8)));
        out.push('');
      }

      out.push(...wrap(f.why, w, '     '));
      out.push('');

      const fixLines = wrap(f.fix, w - 4, '');
      out.push('     ' + c.green('fix') + '  ' + fixLines[0]);
      for (const line of fixLines.slice(1)) out.push('          ' + line);
      out.push('');
    }
  }

  out.push('  ' + c.grey('-'.repeat(w - 2)));
  out.push('  ' + summaryLine(counts, c));
  out.push('');
  out.push('  ' + c.grey(advice(counts)));
  out.push('');

  if (errors.length) out.push(...renderErrors(errors, c));

  return out.join('\n');
}

function summaryLine(counts, c) {
  const parts = SEVERITY_ORDER
    .filter((s) => counts[s] > 0)
    .map((s) => c[SEVERITY_STYLE[s].color](`${counts[s]} ${s}`));
  return parts.join(c.grey('  ·  '));
}

function advice(counts) {
  if (counts.critical > 0) {
    return 'Treat every critical finding as already leaked: rotate the key first, then fix the code.';
  }
  if (counts.high > 0) {
    return 'Nothing is public yet. Close the high findings before this gets traffic.';
  }
  return 'Worth a look when you get a moment. None of this is urgent.';
}

function renderErrors(errors, c) {
  const lines = ['  ' + c.grey('Some checks could not run:')];
  for (const e of errors) lines.push('  ' + c.grey(`  ${e.ruleId}: ${e.message}`));
  lines.push('');
  return lines;
}

/** Machine-readable output for CI and editors. */
export function formatJson(result) {
  return JSON.stringify({
    version: 1,
    summary: result.counts,
    stats: result.stats,
    findings: result.findings,
    errors: result.errors,
  }, null, 2);
}
