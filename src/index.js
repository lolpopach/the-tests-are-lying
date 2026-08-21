import { execFileSync } from 'node:child_process';
import { scanFiles, readGitignore } from './scan.js';
import { RULES } from './rules/index.js';
import { SEVERITY_ORDER } from './rules/helpers.js';

/** Files git knows about, or null when this is not a git repo. */
function readTrackedFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

/**
 * Check a project and return everything worth telling the user about.
 *
 * A rule that throws is reported as a rule failure rather than taking the run
 * down: a crash on one odd file should not cost you the other ten checks.
 */
export function check(root = process.cwd(), { only = null, skip = [] } = {}) {
  const started = Date.now();

  const files = scanFiles(root);
  const context = {
    root,
    files,
    filesByPath: new Map(files.map((f) => [f.relPath, f])),
    gitignore: readGitignore(root),
    trackedFiles: readTrackedFiles(root),
  };

  const findings = [];
  const errors = [];
  const active = RULES
    .filter((rule) => (only ? only.includes(rule.id) : true))
    .filter((rule) => !skip.includes(rule.id));

  for (const rule of active) {
    try {
      for (const finding of rule.check(context)) {
        findings.push({ ruleId: rule.id, ruleTitle: rule.title, ...finding });
      }
    } catch (err) {
      errors.push({ ruleId: rule.id, message: err && err.message ? err.message : String(err) });
    }
  }

  findings.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });

  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0]));
  for (const f of findings) counts[f.severity]++;

  return {
    findings,
    errors,
    counts,
    stats: {
      filesScanned: files.length,
      rulesRun: active.length,
      durationMs: Date.now() - started,
    },
  };
}

export { RULES } from './rules/index.js';
export { SEVERITY } from './rules/helpers.js';
