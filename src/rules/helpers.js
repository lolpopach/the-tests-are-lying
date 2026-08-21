import { lineOf, snippetAt } from '../scan.js';

export const SEVERITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
};

export const SEVERITY_ORDER = [SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.MEDIUM];

/**
 * Values that look like secrets but are obviously fake. Vibe-coded repos are
 * full of these -- every one we report costs the user trust in the whole run.
 */
const PLACEHOLDER_WORDS = [
  'your', 'yours', 'example', 'placeholder', 'changeme', 'change_me',
  'replace', 'insert', 'todo', 'fixme', 'dummy', 'sample', 'test',
  'xxxx', 'abc123', 'foo', 'bar', 'redacted', 'hidden', 'none',
];

export function isPlaceholder(value) {
  if (!value) return true;
  const v = String(value).trim();
  if (v.length < 8) return true;

  const lower = v.toLowerCase();
  if (PLACEHOLDER_WORDS.some((w) => lower.includes(w))) return true;

  // <ANGLE_BRACKETS>, ${INTERPOLATION}, {{TEMPLATE}} are never live values.
  if (/^[<{$]/.test(v) || /[>}]$/.test(v)) return true;
  if (v.includes('${') || v.includes('{{')) return true;

  // A run of identical characters, e.g. sk-aaaaaaaaaaaa or ****************.
  if (/(.)\1{7,}/.test(v)) return true;

  return false;
}

/** Show enough of a secret to identify it, never enough to use it. */
export function redact(value) {
  const v = String(value);
  if (v.length <= 10) return v.slice(0, 2) + '...';
  return v.slice(0, 6) + '...' + v.slice(-2);
}

/**
 * Remove a secret from the source line we quote back.
 *
 * Reports get pasted into issues and captured by CI logs. Echoing the key we
 * are warning about would leak it a second time, somewhere with a longer
 * memory than the file it came from.
 */
export function redactSnippet(snippet, value) {
  if (snippet.includes(value)) return snippet.split(value).join(redact(value));

  // The line may have been truncated mid-secret; cut at the visible fragment.
  const head = String(value).slice(0, 8);
  const at = snippet.indexOf(head);
  return at === -1 ? snippet : snippet.slice(0, at) + redact(value);
}

/** Keep an env assignment's name and drop its value. */
export function redactAssignment(snippet) {
  return snippet.replace(/(=\s*)(\S.*)$/, (_, eq, value) => eq + redact(value.trim()));
}

/**
 * Evidence that the *incoming* request is checked before it is served.
 *
 * The distinction that matters: `Authorization: Bearer ${apiKey}` on an
 * outbound fetch is the file spending a credential, not guarding one. Matching
 * the word "authorization" anywhere would read that backwards and wave through
 * exactly the wide-open proxy endpoints this tool exists to find.
 */
const AUTH_SIGNALS = [
  // Reading a credential off the request that came in.
  /headers\s*\.\s*get\s*\(\s*['"]authorization['"]/i,
  /(?:request|req|ctx|event)\s*\.\s*headers[\s\S]{0,60}?\bauthorization\b/i,
  /(?:request|req)\s*\.\s*(?:cookies?|session|user|auth)\b/i,
  /\bcookies\s*\(\s*\)/,
  /\bgetCookie\s*\(/,

  // Checking that credential.
  /\bverify(?:Token|Jwt|Session|User|Signature|Auth)\s*\(/i,
  /\bjwt\s*\.\s*verify\b/,
  /\b(?:requireAuth|requireUser|ensureAuth|checkAuth|isAuthenticated|authenticate|authorize)\s*\(/i,
  /\bgetServerSession\b|\bgetAuth\s*\(/,
  /supabase\s*\.\s*auth\s*\./,
  /\bclerkClient\b|\bwithAuth\b|\bpassport\s*\./,

  // Comparing a shared secret that arrived with the request.
  /\b(?:apiKey|api_key|token|secret|password)\s*(?:===|!==|==|!=)\s*/i,

  // Turning callers away is strong evidence somebody is being checked.
  /\b(?:401|403)\b/,
];

/**
 * True for files that describe code rather than run it: test fixtures and
 * documentation. Rules that reason about the *shape* of code should skip these,
 * because the shape there is deliberate. Rules that look for a real secret
 * value should not -- a live key pasted into a README is still a live key.
 */
export function isIllustrative(file) {
  return Boolean(file.isTest || file.isDocs);
}

export function hasAuthSignal(content) {
  return AUTH_SIGNALS.some((re) => re.test(content));
}

/** Tokens that suggest the endpoint limits how often it can be called. */
const RATE_LIMIT_SIGNALS = [
  /rate ?limit/i,
  /\bthrottle\b/i,
  /\bquota\b/i,
  /\bbucket\b/i,
  /\bcooldown\b/i,
  /\bslowDown\b/i,
  /upstash.*ratelimit/i,
];

export function hasRateLimitSignal(content) {
  return RATE_LIMIT_SIGNALS.some((re) => re.test(content));
}

/** Hosts that bill per request. Calling these from an open endpoint is a bill. */
export const PAID_API_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.cohere.ai',
  'api.mistral.ai',
  'api.groq.com',
  'openrouter.ai',
  'integrate.api.nvidia.com',
  'api.replicate.com',
  'api.stability.ai',
  'api.elevenlabs.io',
  'api.deepseek.com',
  'api.together.xyz',
  'bedrock-runtime',
];

export function callsPaidApi(content) {
  return PAID_API_HOSTS.find((host) => content.includes(host)) || null;
}

const RELATIVE_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

/** Resolve a relative specifier the few ways a bundler would, and take the first hit. */
function resolveLocal(fromRelPath, specifier, filesByPath) {
  const dir = fromRelPath.split('/').slice(0, -1);
  const parts = [...dir, ...specifier.split('/')];
  const stack = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');

  const candidates = [base];
  if (!/\.[a-z]+$/i.test(base)) {
    for (const ext of ['.js', '.ts', '.mjs', '.jsx', '.tsx']) candidates.push(base + ext);
    for (const ext of ['.js', '.ts']) candidates.push(base + '/index' + ext);
  } else {
    // TypeScript sources are imported with a .js extension.
    candidates.push(base.replace(/\.js$/, '.ts'));
  }

  return candidates.map((c) => filesByPath.get(c)).find(Boolean) || null;
}

/**
 * Find a metered API host in a file, or in the modules it imports directly.
 *
 * Handlers usually delegate the actual call to a helper, so looking only at the
 * handler's own text misses the endpoints that cost the most.
 */
export function callsPaidApiDeep(file, filesByPath) {
  const own = callsPaidApi(file.content);
  if (own) return own;

  const re = new RegExp(RELATIVE_IMPORT.source, 'g');
  let m;
  while ((m = re.exec(file.content)) !== null) {
    const imported = resolveLocal(file.relPath, m[1], filesByPath);
    if (!imported || imported.relPath === file.relPath) continue;
    const host = callsPaidApi(imported.content);
    if (host) return host;
  }
  return null;
}

/**
 * Decode a JWT payload without verifying it. We only ever read the `role`
 * claim, to tell a Supabase anon key (safe in a browser) from a service_role
 * key (full database access, never safe in a browser).
 */
export function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Build a finding anchored to a character offset in a file. */
export function findingAt(file, index, fields) {
  return {
    file: file.relPath,
    line: lineOf(file.content, index),
    snippet: snippetAt(file.content, index),
    side: file.side,
    ...fields,
  };
}

/**
 * Run a regex over content and yield each match with its offset, skipping
 * lines the user has explicitly silenced with a `nomoretime-ignore` comment.
 */
export function* matches(content, regex) {
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const lineStart = content.lastIndexOf('\n', m.index) + 1;
    let lineEnd = content.indexOf('\n', m.index);
    if (lineEnd === -1) lineEnd = content.length;
    const line = content.slice(lineStart, lineEnd);
    if (line.includes('nomoretime-ignore')) continue;

    const prevStart = content.lastIndexOf('\n', lineStart - 2) + 1;
    if (prevStart < lineStart) {
      const prevLine = content.slice(prevStart, lineStart - 1);
      if (prevLine.includes('nomoretime-ignore-next-line')) continue;
    }
    yield { match: m, index: m.index };
  }
}
