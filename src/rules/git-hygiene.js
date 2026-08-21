import { SEVERITY } from './helpers.js';

/** `.env.example` and friends are meant to be committed. Everything else is not. */
const TEMPLATE_SUFFIX = /\.(example|sample|template|dist|defaults?)$/i;

function isRealEnvFile(name) {
  if (!name.startsWith('.env')) return false;
  return !TEMPLATE_SUFFIX.test(name);
}

export const envCommitted = {
  id: 'env-committed',
  title: 'A .env file is committed to git',
  check({ files, trackedFiles }) {
    if (!trackedFiles) return []; // not a git repo, or git unavailable

    const findings = [];
    for (const file of files) {
      if (!isRealEnvFile(file.name)) continue;
      if (!trackedFiles.has(file.relPath)) continue;

      const varCount = file.content
        .split('\n')
        .filter((l) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/.test(l))
        .length;

      findings.push({
        file: file.relPath,
        line: 1,
        snippet: `${varCount} variable${varCount === 1 ? '' : 's'} defined`,
        side: 'server',
        severity: SEVERITY.CRITICAL,
        message: `${file.relPath} is tracked by git`,
        why: 'Anyone who can read the repo can read these values, and deleting the file later does not remove it from history.',
        fix: `Rotate every secret in this file, then run: git rm --cached ${file.relPath} && echo "${file.name}" >> .gitignore`,
      });
    }
    return findings;
  },
};

export const gitignoreMissingEnv = {
  id: 'gitignore-missing-env',
  title: 'A .env file exists but nothing stops you committing it',
  check({ files, gitignore, trackedFiles }) {
    const envFiles = files.filter((f) => isRealEnvFile(f.name));
    if (envFiles.length === 0) return [];

    const patterns = gitignore || [];
    const covers = (name) => patterns.some((p) => {
      const clean = p.replace(/^\/+/, '').replace(/\/+$/, '');
      if (clean === name || clean === '.env' + '*' || clean === '*.env') return true;
      if (clean.endsWith('*') && name.startsWith(clean.slice(0, -1))) return true;
      return false;
    });

    return envFiles
      // An already-committed file is reported by env-committed; do not say it twice.
      .filter((f) => !(trackedFiles && trackedFiles.has(f.relPath)))
      .filter((f) => !covers(f.name))
      .map((f) => ({
        file: f.relPath,
        line: 1,
        snippet: gitignore ? '.gitignore does not cover this file' : 'no .gitignore in this project',
        side: 'server',
        severity: SEVERITY.MEDIUM,
        message: `${f.relPath} is one 'git add .' away from being public`,
        why: 'It is not committed yet. The next time an agent stages everything for you, it will be.',
        fix: `echo "${f.name}" >> .gitignore`,
      }));
  },
};
