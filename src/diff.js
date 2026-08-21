import { execFileSync } from 'node:child_process';

/**
 * Read a unified diff from git.
 *
 * Staged by default, because that is the moment the claim gets made: the agent
 * has finished, staged its work, and is about to say it passes.
 */
export function readDiff(cwd = process.cwd(), { source = 'staged', range = null } = {}) {
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3', '--find-renames'];

  if (range) args.push(range);
  else if (source === 'staged') args.push('--cached');
  else if (source === 'head') args.push('HEAD');
  // 'unstaged' needs no extra flag: plain `git diff` is the working tree.

  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff into files, hunks, and lines.
 *
 * Every line keeps the number it has in the version it belongs to: removed
 * lines carry their old line number, added lines carry their new one. A
 * finding has to point somewhere the reader can actually look.
 */
export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split('\n')) {
    const header = FILE_HEADER.exec(raw);
    if (header) {
      file = {
        oldPath: header[1],
        path: header[2],
        isNew: false,
        isDeleted: false,
        isRename: header[1] !== header[2],
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (raw.startsWith('new file mode')) { file.isNew = true; continue; }
    if (raw.startsWith('deleted file mode')) { file.isDeleted = true; continue; }
    if (raw.startsWith('Binary files')) { file.isBinary = true; continue; }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) continue;

    const hunkHeader = HUNK_HEADER.exec(raw);
    if (hunkHeader) {
      oldLine = Number(hunkHeader[1]);
      newLine = Number(hunkHeader[3]);
      hunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (raw.startsWith('+')) {
      hunk.lines.push({ type: 'add', text: raw.slice(1), line: newLine, file, hunk });
      newLine++;
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ type: 'del', text: raw.slice(1), line: oldLine, file, hunk });
      oldLine++;
    } else if (raw.startsWith(' ')) {
      hunk.lines.push({ type: 'ctx', text: raw.slice(1), line: newLine, file, hunk });
      oldLine++;
      newLine++;
    }
    // '\\ No newline at end of file' and anything else is not a content line.
  }

  return { files };
}

/** Flatten to the added lines, which is where a weakening is introduced. */
export function addedLines(diff) {
  const out = [];
  for (const file of diff.files) {
    if (file.isBinary) continue;
    for (const hunk of file.hunks) {
      for (const l of hunk.lines) if (l.type === 'add') out.push(l);
    }
  }
  return out;
}

/** Flatten to the removed lines, which is where a check goes to die. */
export function removedLines(diff) {
  const out = [];
  for (const file of diff.files) {
    if (file.isBinary) continue;
    for (const hunk of file.hunks) {
      for (const l of hunk.lines) if (l.type === 'del') out.push(l);
    }
  }
  return out;
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)\/|[._-](test|spec)s?\.[a-z]+$|(^|\/)test_|_test\.[a-z]+$/i;

/** Is this file part of the test suite -- the thing that is supposed to be hard to please? */
export function isTestFile(path) {
  return TEST_PATH.test(path);
}

const CI_PATH = /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)(azure-pipelines|bitbucket-pipelines|\.circleci\/config)\.ya?ml$|(^|\/)Jenkinsfile$|(^|\/)\.pre-commit-config\.yaml$|(^|\/)\.husky\//i;

/** Is this file the thing that runs the checks in CI? */
export function isCiFile(path) {
  return CI_PATH.test(path);
}

/** Lines the author has explicitly signed off on. */
export function isAcknowledged(text) {
  return /tests-are-lying-ignore|allow-weakening/.test(text);
}
