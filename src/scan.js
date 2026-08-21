import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname } from 'node:path';

/** Directories that are never worth scanning: generated, vendored, or huge. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next',
  '.nuxt', '.output', '.svelte-kit', '.astro', 'coverage', 'vendor',
  '.venv', 'venv', '__pycache__', '.cache', '.turbo', '.vercel', '.wrangler',
  '.parcel-cache', 'target', 'bower_components', '.pytest_cache', '.gradle',
  '.idea', '.vscode', 'Pods', '.terraform',
]);

/** Extensions we can meaningfully read as source text. */
const TEXT_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.vue', '.svelte', '.astro', '.html', '.htm',
  '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.py', '.go', '.rb', '.php', '.java', '.kt', '.cs', '.rs',
  '.sh', '.bash', '.zsh', '.env', '.rules', '.tf', '.tfvars',
  '.md', '.mdx', '.sql', '.graphql', '.prisma',
]);

/** Files without a useful extension that we still want to read. */
const TEXT_NAMES = new Set([
  'Dockerfile', 'Procfile', 'Makefile', '.env', '.gitignore', '.npmrc',
  '.dockerignore', 'wrangler.toml', 'vercel.json', 'netlify.toml',
]);

const MAX_FILE_BYTES = 512 * 1024;
const NUL_BYTE = String.fromCharCode(0);

/**
 * Test suites are full of deliberately terrible code -- that is their job.
 * Flagging a fixture that exists to prove a vulnerability is detected wastes
 * the one thing this tool is trying to protect.
 */
const TEST_PATH = /(^|\/)(tests?|__tests__|__mocks__|spec|specs|e2e|cypress|playwright|fixtures?)\/|\.(test|spec|fixture|stories)\.[a-z]+$/i;

/** Prose about a mistake is not the mistake. */
const DOCS_PATH = /\.mdx?$/i;

function isTextFile(name) {
  if (TEXT_NAMES.has(name)) return true;
  if (name.startsWith('.env')) return true;
  return TEXT_EXT.has(extname(name).toLowerCase());
}

/**
 * Decide whether a file runs on a server or ships to the browser.
 *
 * This drives severity everywhere else: a secret in server code is a mistake,
 * the same secret in client code is already public. We only claim 'client' or
 * 'server' when a path or directive says so, and fall back to 'unknown'
 * rather than guessing -- an unknown file never triggers a critical finding.
 */
export function classifyFile(relPath, content) {
  const lower = relPath.split(sep).join('/').toLowerCase();

  // Explicit runtime directives win over any path heuristic.
  if (/^\s*['"]use server['"]/m.test(content)) return 'server';
  if (/^\s*['"]use client['"]/m.test(content)) return 'client';

  const SERVER_PATTERNS = [
    /(^|\/)functions\//,           // Cloudflare Pages Functions
    /(^|\/)api\//,                 // Next pages/api, generic /api/
    /(^|\/)server\//,
    /(^|\/)workers?\//,
    /(^|\/)netlify\/functions\//,
    /(^|\/)supabase\/functions\//,
    /(^|\/)lambda\//,
    /\.server\.[jt]sx?$/,
    /(^|\/)route\.[jt]sx?$/,       // Next.js app router route handler
    /(^|\/)middleware\.[jt]sx?$/,
    /(^|\/)worker\.[jt]s$/,
  ];
  if (SERVER_PATTERNS.some((re) => re.test(lower))) return 'server';

  const CLIENT_PATTERNS = [
    /\.(html?|vue|svelte|astro|jsx|tsx)$/,
    /(^|\/)(src|app|components|pages|islands|public|static|assets|www)\//,
  ];
  if (CLIENT_PATTERNS.some((re) => re.test(lower))) return 'client';

  // A bare .js next to an index.html is almost always browser code.
  if (/\.(js|mjs)$/.test(lower) && !lower.includes('/')) return 'client';

  return 'unknown';
}

/** Walk the project, returning readable text files with their contents. */
export function scanFiles(root, { extraSkipDirs = [] } = {}) {
  const skip = new Set([...SKIP_DIRS, ...extraSkipDirs]);
  const files = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: not our problem to report
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTextFile(entry.name)) continue;

      let content;
      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue;
        content = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (content.includes(NUL_BYTE)) continue; // binary masquerading as text

      const relPath = relative(root, full);
      files.push({
        path: full,
        relPath: relPath.split(sep).join('/'),
        name: entry.name,
        content,
        side: classifyFile(relPath, content),
        isTest: TEST_PATH.test(relPath.split(sep).join('/')),
        isDocs: DOCS_PATH.test(entry.name),
      });
    }
  }

  walk(root);
  return files;
}

/** Read .gitignore patterns as plain lines; enough to answer "is .env ignored?". */
export function readGitignore(root) {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return null;
  }
}

/** Convert a character offset into a 1-indexed line number. */
export function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** The source line at an offset, trimmed and truncated for display. */
export function snippetAt(content, index, max = 100) {
  const start = content.lastIndexOf('\n', index) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  const line = content.slice(start, end).trim();
  return line.length > max ? line.slice(0, max - 1) + '...' : line;
}
