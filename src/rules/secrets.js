import {
  SEVERITY, isPlaceholder, redact, redactSnippet, redactAssignment, jwtRole,
  isIllustrative, findingAt, matches,
} from './helpers.js';
import { snippetAt } from '../scan.js';

/**
 * Credential shapes distinctive enough to be worth reporting on sight.
 * Ordered most-specific first so `sk-ant-...` is reported as an Anthropic key
 * rather than a generic OpenAI-shaped one.
 */
const CREDENTIAL_PATTERNS = [
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprse]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe live key', re: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}/ },
  { name: 'Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{32,}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'Gemfile.lock', 'poetry.lock', 'bun.lockb',
]);

export const hardcodedCredential = {
  id: 'hardcoded-credential',
  title: 'A real API key is written into the source',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (LOCKFILES.has(file.name)) continue;
      // A .env file is where a key is supposed to live. env-committed and
      // public-env-secret cover the two ways that goes wrong.
      if (file.name.startsWith('.env')) continue;

      // Track byte ranges already claimed so one key is reported once, by its
      // most specific pattern.
      const claimed = [];
      const isClaimed = (i) => claimed.some(([s, e]) => i >= s && i < e);

      for (const { name, re } of CREDENTIAL_PATTERNS) {
        for (const { match, index } of matches(file.content, re)) {
          if (isClaimed(index)) continue;
          const value = match[0];
          if (isPlaceholder(value)) continue;
          claimed.push([index, index + value.length]);

          const inBrowser = file.side === 'client';
          findings.push(findingAt(file, index, {
            snippet: redactSnippet(snippetAt(file.content, index), value),
            severity: inBrowser ? SEVERITY.CRITICAL : SEVERITY.HIGH,
            message: `${name} hardcoded (${redact(value)})`,
            why: inBrowser
              ? 'This file ships to the browser. Anyone who opens devtools can read this key and spend your money with it.'
              : 'A key in source is a key in git history, and git history goes wherever the repo goes.',
            fix: 'Rotate this key now -- it should be assumed leaked. Then read it from an environment variable on the server instead.',
          }));
        }
      }

      // Supabase and friends hand out two JWTs that look identical. One is
      // safe in a browser; the other is a skeleton key for your database.
      for (const { match, index } of matches(file.content, JWT_PATTERN)) {
        if (isClaimed(index)) continue;
        const role = jwtRole(match[0]);
        if (role !== 'service_role') continue;
        claimed.push([index, index + match[0].length]);

        findings.push(findingAt(file, index, {
          snippet: redactSnippet(snippetAt(file.content, index), match[0]),
          severity: SEVERITY.CRITICAL,
          message: `Supabase service_role key hardcoded (${redact(match[0])})`,
          why: 'The service_role key bypasses every row-level security policy you wrote. It is not the anon key -- check the role claim if you are unsure.',
          fix: 'Rotate it in the Supabase dashboard, then use the anon key in the browser and keep service_role on the server only.',
        }));
      }
    }

    return findings;
  },
};

const PUBLIC_PREFIXES = [
  'NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'PUBLIC_', 'GATSBY_',
  'EXPO_PUBLIC_', 'NUXT_PUBLIC_', 'VUE_APP_', 'STORYBOOK_', 'PLASMO_PUBLIC_',
];

/** Names that mean "secret" no matter what else is in them. */
const STRONG_SECRET = /SECRET|PRIVATE|SERVICE_ROLE|SERVICEROLE|PASSWORD|PASSWD|CREDENTIAL|SIGNING/;

/** Names that usually mean "secret", unless the name also says it is public. */
const WEAK_SECRET = /API_?KEY|TOKEN|ACCESS_?KEY|WEBHOOK|SALT|ADMIN/;

/** Public by design: Firebase web config, Supabase anon key, reCAPTCHA site key. */
const KNOWN_PUBLIC = /ANON|PUBLISHABLE|PUBLIC_KEY|SITE_KEY|CLIENT_ID|MEASUREMENT_ID|APP_ID|PROJECT_ID|SENDER_ID|FIREBASE|VAPID/;

function looksSecret(name) {
  if (STRONG_SECRET.test(name)) return true;
  if (KNOWN_PUBLIC.test(name)) return false;
  return WEAK_SECRET.test(name);
}

export const publicEnvSecret = {
  id: 'public-env-secret',
  title: 'A secret is stored under a build-time public prefix',
  check({ files }) {
    const findings = [];
    const seen = new Set();

    const prefixGroup = PUBLIC_PREFIXES.map((p) => p.replace(/_/g, '_')).join('|');
    const NAME_RE = new RegExp(`\\b((?:${prefixGroup})[A-Z0-9_]+)`);

    for (const file of files) {
      if (LOCKFILES.has(file.name)) continue;
      if (isIllustrative(file)) continue;

      for (const { match, index } of matches(file.content, NAME_RE)) {
        const name = match[1];
        if (!looksSecret(name)) continue;

        const key = `${file.relPath}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const prefix = PUBLIC_PREFIXES.find((p) => name.startsWith(p));
        findings.push(findingAt(file, index, {
          snippet: redactAssignment(snippetAt(file.content, index)),
          severity: SEVERITY.CRITICAL,
          message: `${name} is inlined into the browser bundle`,
          why: `Your bundler replaces every ${prefix}* variable with its literal value at build time. The value ends up in the JavaScript you serve, so it is public the moment you deploy.`,
          fix: `Drop the ${prefix} prefix and read this variable on the server. If the browser genuinely needs the result, put a small API route in front of it.`,
        }));
      }
    }

    return findings;
  },
};
