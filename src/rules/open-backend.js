import {
  SEVERITY, hasAuthSignal, callsPaidApi, isIllustrative, findingAt, matches,
} from './helpers.js';

/** Handlers that change state rather than just read it. */
const MUTATING_HANDLER = [
  /export\s+(?:async\s+)?function\s+onRequest(Post|Put|Delete|Patch)\b/,
  /export\s+(?:async\s+)?function\s+(POST|PUT|DELETE|PATCH)\b/,
  /export\s+const\s+(POST|PUT|DELETE|PATCH)\s*=/,
  /\b(?:app|router|server)\.(post|put|delete|patch)\s*\(/,
  /request\.method\s*===?\s*['"](POST|PUT|DELETE|PATCH)['"]/,
  /req\.method\s*===?\s*['"](POST|PUT|DELETE|PATCH)['"]/,
];

/** Evidence the handler actually writes something worth protecting. */
const MUTATION_SIGNALS = [
  /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i,
  /\.(insert|upsert|update|delete|destroy|create|createMany|deleteMany)\s*\(/,
  /\b(?:KV|env\.[A-Z_]+)\.put\s*\(/,
  /\bprisma\.\w+\.(create|update|delete)/,
  /supabase\s*\.from\s*\(/,
  /\bwriteFile|\bmkdir\b/,
  /\.set\s*\(\s*\{/,
  /\bbucket\.\w*(put|upload|write)/i,
];

/** Endpoints whose whole job is to run before anyone is authenticated. */
const PUBLIC_BY_DESIGN = /(login|signin|sign-in|signup|sign-up|register|auth|session|callback|oauth|reset-password|forgot)/i;

export const unauthenticatedWrite = {
  id: 'unauthenticated-write',
  title: 'A write endpoint accepts anyone',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (file.side !== 'server') continue;
      if (isIllustrative(file)) continue;
      if (PUBLIC_BY_DESIGN.test(file.relPath)) continue;
      if (hasAuthSignal(file.content)) continue;
      if (!MUTATION_SIGNALS.some((re) => re.test(file.content))) continue;

      const handler = MUTATING_HANDLER
        .map((re) => [...matches(file.content, re)][0])
        .find(Boolean);
      if (!handler) continue;

      findings.push(findingAt(file, handler.index, {
        severity: SEVERITY.HIGH,
        message: `${file.relPath} writes data with no check on who is calling`,
        why: 'This handler changes stored data and nothing in the file looks at a session, token, or cookie first. Anyone who finds the URL can call it as many times as they like.',
        fix: 'Verify the caller before you write: check a session or a signed token at the top of the handler and return 401 when it is missing.',
      }));
    }

    return findings;
  },
};

const CORS_WILDCARD = /['"]Access-Control-Allow-Origin['"]\s*[:,]\s*['"]\*['"]/i;
const CORS_CREDENTIALS = /['"]Access-Control-Allow-Credentials['"]\s*[:,]\s*['"]?true/i;

export const openCors = {
  id: 'open-cors',
  title: 'CORS is open to every origin',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (file.side === 'client') continue;
      if (isIllustrative(file)) continue;

      const hit = [...matches(file.content, CORS_WILDCARD)][0];
      if (!hit) continue;

      const withCredentials = CORS_CREDENTIALS.test(file.content);
      const paidHost = callsPaidApi(file.content);

      if (withCredentials) {
        findings.push(findingAt(file, hit.index, {
          severity: SEVERITY.HIGH,
          message: 'Allow-Origin: * combined with Allow-Credentials: true',
          why: 'Browsers reject this pairing, so the endpoint is broken for real users -- and where it does get through, any site can make authenticated requests as your logged-in visitors.',
          fix: 'Name the origins you actually serve instead of using *.',
        }));
        continue;
      }

      if (paidHost) {
        findings.push(findingAt(file, hit.index, {
          severity: SEVERITY.HIGH,
          message: `Any website can call this endpoint, and it calls ${paidHost}`,
          why: 'With a wildcard origin, someone else can point their own site at this URL and every call is billed to you.',
          fix: 'Restrict Allow-Origin to your own domain, and add a rate limit per IP.',
        }));
        continue;
      }

      findings.push(findingAt(file, hit.index, {
        severity: SEVERITY.MEDIUM,
        message: 'Allow-Origin is set to *',
        why: 'Fine for a genuinely public read-only API. A problem for anything else, and agents add this line to make a CORS error go away rather than because you wanted it.',
        fix: 'If this endpoint is not meant to be public, list your own origin instead.',
      }));
    }

    return findings;
  },
};

const RULES_FILE = /(firestore|storage|database)\.rules$|\.rules$|database\.rules\.json$/;
const ALLOW_ANYONE = /allow\s+[a-z,\s]*(?:read|write)[a-z,\s]*:\s*if\s+true/i;
const RTDB_OPEN = /['"]\.(?:read|write)['"]\s*:\s*(?:true|['"]true['"])/;

export const firebaseOpenRules = {
  id: 'firebase-open-rules',
  title: 'Firebase security rules allow anyone to read or write',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (!RULES_FILE.test(file.name)) continue;
      if (isIllustrative(file)) continue;

      const pattern = file.name.endsWith('.json') ? RTDB_OPEN : ALLOW_ANYONE;
      const hit = [...matches(file.content, pattern)][0];
      if (!hit) continue;

      findings.push(findingAt(file, hit.index, {
        severity: SEVERITY.CRITICAL,
        message: `${file.relPath} grants access to everyone`,
        why: 'These rules are the only thing between the public internet and your database. `if true` means there is nothing between them.',
        fix: 'Scope each rule to the signed-in owner, e.g. `allow read, write: if request.auth != null && request.auth.uid == userId;`',
      }));
    }

    return findings;
  },
};
