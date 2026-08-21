import { readDiff, parseDiff, addedLines, removedLines, isAcknowledged } from './diff.js';
import { RULES } from './rules/index.js';
import { LEVEL_ORDER } from './rules/helpers.js';

/**
 * Inspect a diff for changes that make the checks easier to pass.
 *
 * The question is never "did the tests change" -- tests change constantly.
 * It is "did this change make a failing thing pass without the code being any
 * different", which is a much narrower and much more answerable question.
 */
export function inspect(cwd = process.cwd(), { source = 'staged', range = null, only = null, skip = [], diffText = null } = {}) {
  const started = Date.now();

  const text = diffText !== null ? diffText : readDiff(cwd, { source, range });
  const diff = parseDiff(text);
  const context = {
    diff,
    added: addedLines(diff).filter((l) => !isAcknowledged(l.text)),
    removed: removedLines(diff),
  };

  const findings = [];
  const errors = [];
  const active = RULES
    .filter((rule) => (only ? only.includes(rule.id) : true))
    .filter((rule) => !skip.includes(rule.id));

  for (const rule of active) {
    try {
      for (const f of rule.check(context)) {
        findings.push({ ruleId: rule.id, ruleTitle: rule.title, ...f });
      }
    } catch (err) {
      errors.push({ ruleId: rule.id, message: err && err.message ? err.message : String(err) });
    }
  }

  findings.sort((a, b) => {
    const byLevel = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
    if (byLevel !== 0) return byLevel;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });

  const counts = Object.fromEntries(LEVEL_ORDER.map((l) => [l, 0]));
  for (const f of findings) counts[f.level]++;

  return {
    findings,
    errors,
    counts,
    stats: {
      filesChanged: diff.files.length,
      linesAdded: context.added.length,
      linesRemoved: context.removed.length,
      rulesRun: active.length,
      durationMs: Date.now() - started,
    },
  };
}

export { RULES } from './rules/index.js';
export { LEVEL } from './rules/helpers.js';
