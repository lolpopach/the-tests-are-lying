import { LEVEL_ORDER } from './rules/helpers.js';

const ESC = String.fromCharCode(27);

const ANSI = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  green: `${ESC}[32m`,
  grey: `${ESC}[90m`,
};

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

const LEVEL_STYLE = {
  lying: { label: 'LYING', color: 'red', mark: '!', gloss: 'the check passes without testing anything' },
  muted: { label: 'MUTED', color: 'yellow', mark: '*', gloss: 'a real failure is being hidden' },
  looser: { label: 'LOOSER', color: 'blue', mark: '-', gloss: 'the check still runs, it is just easier to pass' },
};

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

export function formatReport(result, { color = true, width = 80 } = {}) {
  const c = makePainter(color);
  const { findings, counts, stats, errors } = result;
  const out = [];
  const w = Math.min(Math.max(width, 60), 100);

  out.push('');
  out.push(
    '  ' + c.bold('the-tests-are-lying') + '  ' +
    c.grey(`${stats.filesChanged} changed file${stats.filesChanged === 1 ? '' : 's'}`)
  );
  out.push('');

  if (findings.length === 0) {
    out.push('  ' + c.green('Nothing weakened.') + ' ' +
      c.grey('The checks are as hard to pass as they were.'));
    out.push('');
    if (errors.length) out.push(...renderErrors(errors, c));
    return out.join('\n');
  }

  for (const level of LEVEL_ORDER) {
    const group = findings.filter((f) => f.level === level);
    if (group.length === 0) continue;

    const style = LEVEL_STYLE[level];
    out.push(
      '  ' + c[style.color](c.bold(style.label)) + '  ' + c.grey(String(group.length)) +
      c.grey('   ' + style.gloss)
    );
    out.push('  ' + c.grey('-'.repeat(w - 2)));
    out.push('');

    for (const f of group) {
      out.push('  ' + c[style.color](style.mark) + '  ' + c.bold(f.message));
      out.push(
        '     ' + c.grey(`${f.file}:${f.line}`) + c.grey('  ·  ') + c.grey(f.ruleId) +
        c.grey('  ·  ') + c.grey(f.side === 'removed' ? 'removed' : 'added')
      );
      out.push('');

      if (f.snippet) {
        const mark = f.side === 'removed' ? '- ' : '+ ';
        out.push('     ' + c.dim(mark + truncate(f.snippet, w - 10)));
        out.push('');
      }

      out.push(...wrap(f.why, w, '     '));
      out.push('');

      const askLines = wrap(f.ask, w - 4, '');
      out.push('     ' + c.green('ask') + '  ' + askLines[0]);
      for (const line of askLines.slice(1)) out.push('          ' + line);
      out.push('');
    }
  }

  out.push('  ' + c.grey('-'.repeat(w - 2)));
  out.push('  ' + summaryLine(counts, c));
  out.push('');
  out.push(...wrap(c.grey(verdict(counts)), w, '  '));
  out.push('');

  if (errors.length) out.push(...renderErrors(errors, c));

  return out.join('\n');
}

function summaryLine(counts, c) {
  return LEVEL_ORDER
    .filter((l) => counts[l] > 0)
    .map((l) => c[LEVEL_STYLE[l].color](`${counts[l]} ${l}`))
    .join(c.grey('  ·  '));
}

function verdict(counts) {
  if (counts.lying > 0) {
    return 'A green run on this diff proves nothing. Get the checks back first, then find out what was actually failing.';
  }
  if (counts.muted > 0) {
    return 'Something was failing and is now out of sight. It is still failing.';
  }
  return 'Nothing is hidden. The bar just moved a little; worth knowing why.';
}

function renderErrors(errors, c) {
  const lines = ['  ' + c.grey('Some checks could not run:')];
  for (const e of errors) lines.push('  ' + c.grey(`  ${e.ruleId}: ${e.message}`));
  lines.push('');
  return lines;
}

/**
 * The message to send back to whoever wrote the diff.
 *
 * The findings are for the human. This is for the agent, and it is the whole
 * point of the tool: the fastest correct response to a weakened check is to
 * hand the list back and refuse the green.
 */
export function formatReply(result) {
  const { findings, counts } = result;
  if (findings.length === 0) return 'No checks were weakened in this diff.';

  const lines = [];
  lines.push('You made the checks easier to pass instead of making the code correct. Undo these, then tell me what was actually failing:');
  lines.push('');

  for (const f of findings) {
    lines.push(`- ${f.file}:${f.line} — ${f.message}`);
  }

  lines.push('');
  if (counts.lying > 0) {
    lines.push('Do not report this as passing until the removed checks are back and green on their own.');
  } else {
    lines.push('Restore each of these, then show me the failure output before changing anything else.');
  }
  return lines.join('\n');
}

export function formatJson(result) {
  return JSON.stringify({
    version: 1,
    summary: result.counts,
    stats: result.stats,
    findings: result.findings,
    errors: result.errors,
    reply: formatReply(result),
  }, null, 2);
}
