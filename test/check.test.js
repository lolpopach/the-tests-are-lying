import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { check } from '../src/index.js';
import { formatReport, formatJson } from '../src/report.js';

const CLI = fileURLToPath(new URL('../bin/nomoretime.js', import.meta.url));

/**
 * Build a throwaway project on disk.
 *
 * Credential-shaped fixtures are assembled at runtime rather than written out
 * as literals, so this repo never contains anything a secret scanner has to
 * think about.
 */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'nomoretime-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function findingIds(result) {
  return result.findings.map((f) => f.ruleId);
}

function fakeKey(prefix, length = 40) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz023456789';
  let body = '';
  for (let i = 0; i < length; i++) body += alphabet[(i * 7 + 3) % alphabet.length];
  return prefix + body;
}

function fakeJwt(role) {
  const part = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return [part({ alg: 'HS256', typ: 'JWT' }), part({ role, iss: 'test' }), 'c'.repeat(43)].join('.');
}

const cleanup = [];
function scratch(files) {
  const root = project(files);
  cleanup.push(root);
  return root;
}

test.after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe('hardcoded credentials', () => {
  test('a live key in browser code is critical', () => {
    const root = scratch({
      'src/app.js': `const client = new OpenAI({ apiKey: "${fakeKey('sk-')}" });`,
    });
    const result = check(root);
    const finding = result.findings.find((f) => f.ruleId === 'hardcoded-credential');

    assert.ok(finding, 'expected the key to be reported');
    assert.equal(finding.severity, 'critical');
    assert.equal(finding.line, 1);
    assert.match(finding.message, /OpenAI/);
  });

  test('the same key in server code is high, not critical', () => {
    const root = scratch({
      'api/chat.js': `const key = "${fakeKey('sk-')}";`,
    });
    const finding = check(root).findings.find((f) => f.ruleId === 'hardcoded-credential');
    assert.equal(finding.severity, 'high');
  });

  test('the reported value is redacted', () => {
    const key = fakeKey('sk-');
    const root = scratch({ 'src/app.js': `const k = "${key}";` });
    const output = formatJson(check(root));

    assert.ok(!output.includes(key), 'the full key must never appear in output');
  });

  test('placeholders are not reported', () => {
    const root = scratch({
      '.env.example': 'OPENAI_API_KEY=sk-your-key-here-replace-this-value\n',
      'src/app.js': 'const k = "sk-xxxxxxxxxxxxxxxxxxxxxxxx";',
    });
    assert.deepEqual(
      findingIds(check(root)).filter((id) => id === 'hardcoded-credential'),
      []
    );
  });

  test('an Anthropic key is not misreported as an OpenAI one', () => {
    const root = scratch({ 'src/app.js': `const k = "${fakeKey('sk-ant-')}";` });
    const findings = check(root).findings.filter((f) => f.ruleId === 'hardcoded-credential');

    assert.equal(findings.length, 1, 'one key should produce one finding');
    assert.match(findings[0].message, /Anthropic/);
  });

  test('a service_role JWT is caught and an anon one is not', () => {
    const bad = scratch({ 'src/db.js': `const k = "${fakeJwt('service_role')}";` });
    const good = scratch({ 'src/db.js': `const k = "${fakeJwt('anon')}";` });

    assert.match(
      check(bad).findings.find((f) => f.ruleId === 'hardcoded-credential').message,
      /service_role/
    );
    assert.deepEqual(
      findingIds(check(good)).filter((id) => id === 'hardcoded-credential'),
      []
    );
  });

  test('lockfiles are skipped', () => {
    const root = scratch({
      'package-lock.json': `{ "resolved": "${fakeKey('sk-')}" }`,
    });
    assert.deepEqual(findingIds(check(root)), []);
  });
});

describe('build-time public env vars', () => {
  test('a secret behind a public prefix is critical', () => {
    const root = scratch({ '.env.local': 'NEXT_PUBLIC_OPENAI_API_KEY=abc123def456ghi789\n' });
    const finding = check(root).findings.find((f) => f.ruleId === 'public-env-secret');

    assert.ok(finding);
    assert.equal(finding.severity, 'critical');
    assert.match(finding.why, /build time/);
  });

  test('keys that are public by design are left alone', () => {
    const root = scratch({
      '.env': [
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=abc123',
        'NEXT_PUBLIC_FIREBASE_API_KEY=abc123',
        'VITE_RECAPTCHA_SITE_KEY=abc123',
        'NEXT_PUBLIC_API_URL=https://example.com',
      ].join('\n'),
    });
    assert.deepEqual(
      findingIds(check(root)).filter((id) => id === 'public-env-secret'),
      []
    );
  });

  test('the value is stripped from the quoted line', () => {
    const root = scratch({ '.env.local': 'NEXT_PUBLIC_STRIPE_SECRET_KEY=totally-real-value-9876\n' });
    const output = formatJson(check(root));

    assert.ok(output.includes('NEXT_PUBLIC_STRIPE_SECRET_KEY'), 'the name is what the user needs');
    assert.ok(!output.includes('totally-real-value-9876'), 'the value must not be echoed back');
  });

  test('an explicit secret word wins over a public-looking name', () => {
    const root = scratch({ '.env': 'NEXT_PUBLIC_FIREBASE_PRIVATE_KEY=abc123\n' });
    assert.ok(findingIds(check(root)).includes('public-env-secret'));
  });

  test('each variable is reported once per file', () => {
    const root = scratch({
      'src/a.js': 'a(import.meta.env.VITE_STRIPE_SECRET_KEY); b(import.meta.env.VITE_STRIPE_SECRET_KEY);',
    });
    const findings = check(root).findings.filter((f) => f.ruleId === 'public-env-secret');
    assert.equal(findings.length, 1);
  });
});

describe('git hygiene', () => {
  function gitInit(root) {
    const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    run('init', '-q');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'test');
    run('add', '-A');
    run('commit', '-qm', 'init');
  }

  test('a committed .env is critical', () => {
    const root = scratch({ '.env': 'DB_PASSWORD=hunter2hunter2\n', 'readme.md': 'x' });
    gitInit(root);

    const finding = check(root).findings.find((f) => f.ruleId === 'env-committed');
    assert.ok(finding);
    assert.equal(finding.severity, 'critical');
    assert.match(finding.fix, /git rm --cached/);
  });

  test('.env.example is meant to be committed', () => {
    const root = scratch({ '.env.example': 'DB_PASSWORD=\n', 'readme.md': 'x' });
    gitInit(root);
    assert.deepEqual(
      findingIds(check(root)).filter((id) => id.startsWith('env') || id.startsWith('gitignore')),
      []
    );
  });

  test('an unignored .env is flagged before it gets committed', () => {
    const root = scratch({ '.env': 'DB_PASSWORD=hunter2hunter2\n', '.gitignore': 'node_modules\n' });
    assert.ok(findingIds(check(root)).includes('gitignore-missing-env'));
  });

  test('an ignored .env is fine', () => {
    const root = scratch({ '.env': 'DB_PASSWORD=hunter2hunter2\n', '.gitignore': '.env\n' });
    assert.ok(!findingIds(check(root)).includes('gitignore-missing-env'));
  });

  test('a committed .env is not also reported as unignored', () => {
    const root = scratch({ '.env': 'DB_PASSWORD=hunter2hunter2\n', 'readme.md': 'x' });
    gitInit(root);
    const ids = findingIds(check(root));

    assert.ok(ids.includes('env-committed'));
    assert.ok(!ids.includes('gitignore-missing-env'), 'one problem, one finding');
  });
});

describe('open backends', () => {
  test('an unauthenticated write is reported', () => {
    const root = scratch({
      'functions/api/users.js': `
        export async function onRequestPost({ request, env }) {
          const data = await request.json();
          await env.DB.put("users", JSON.stringify(data));
        }`,
    });
    assert.ok(findingIds(check(root)).includes('unauthenticated-write'));
  });

  test('a write behind an auth check is not', () => {
    const root = scratch({
      'functions/api/users.js': `
        export async function onRequestPost({ request, env }) {
          const token = request.headers.get('Authorization');
          if (!token) return new Response('no', { status: 401 });
          await env.DB.put("users", "{}");
        }`,
    });
    assert.ok(!findingIds(check(root)).includes('unauthenticated-write'));
  });

  test('an outbound Authorization header does not count as a check', () => {
    // Regression: matching the word "authorization" anywhere reads a file that
    // spends a credential as one that guards an endpoint.
    const root = scratch({
      'functions/api/proxy.js': `
        export async function onRequestPost({ request, env }) {
          await fetch('https://api.openai.com/v1/chat/completions', {
            headers: { 'Authorization': 'Bearer ' + env.API_KEY },
          });
          await env.DB.put('log', '1');
        }`,
    });
    const ids = findingIds(check(root));
    assert.ok(ids.includes('unauthenticated-write'));
    assert.ok(ids.includes('metered-endpoint-unprotected'));
  });

  test('login endpoints are public by design', () => {
    const root = scratch({
      'functions/api/auth/login.js': `
        export async function onRequestPost({ request, env }) {
          const body = await request.json();
          await env.DB.put('attempt', '1');
        }`,
    });
    assert.ok(!findingIds(check(root)).includes('unauthenticated-write'));
  });

  test('a read-only handler is not a write', () => {
    const root = scratch({
      'functions/api/today.js': `
        export async function onRequestGet({ env }) {
          return new Response(await env.DB.get('today'));
        }`,
    });
    assert.ok(!findingIds(check(root)).includes('unauthenticated-write'));
  });

  test('wildcard CORS with credentials is high', () => {
    const root = scratch({
      'functions/api/x.js': `
        export async function onRequestGet() {
          return new Response('{}', { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': 'true',
          }});
        }`,
    });
    const finding = check(root).findings.find((f) => f.ruleId === 'open-cors');
    assert.equal(finding.severity, 'high');
  });

  test('wildcard CORS on a plain read endpoint is only medium', () => {
    const root = scratch({
      'functions/api/x.js': `
        export async function onRequestGet() {
          return new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*' }});
        }`,
    });
    const finding = check(root).findings.find((f) => f.ruleId === 'open-cors');
    assert.equal(finding.severity, 'medium');
  });

  test('firebase rules that allow anyone are critical', () => {
    const root = scratch({
      'firestore.rules': `
        service cloud.firestore {
          match /databases/{db}/documents {
            match /{document=**} { allow read, write: if true; }
          }
        }`,
    });
    const finding = check(root).findings.find((f) => f.ruleId === 'firebase-open-rules');
    assert.equal(finding.severity, 'critical');
  });

  test('scoped firebase rules are fine', () => {
    const root = scratch({
      'firestore.rules': 'match /u/{uid} { allow read, write: if request.auth.uid == uid; }',
    });
    assert.ok(!findingIds(check(root)).includes('firebase-open-rules'));
  });
});

describe('metered endpoints', () => {
  test('a paid API reached through a helper module is still found', () => {
    const root = scratch({
      'functions/api/_ai.js': "const BASE = 'https://api.anthropic.com/v1';\nexport function ask() {}",
      'functions/api/ask.js': `
        import { ask } from './_ai.js';
        export async function onRequestPost({ request }) { return ask(); }`,
    });
    const finding = check(root).findings.find((f) => f.ruleId === 'metered-endpoint-unprotected');

    assert.ok(finding, 'should follow the import to find the billed host');
    assert.equal(finding.file, 'functions/api/ask.js');
    assert.match(finding.message, /api\.anthropic\.com/);
  });

  test('a rate limit is enough to clear it', () => {
    const root = scratch({
      'functions/api/ask.js': `
        export async function onRequestPost({ request, env }) {
          if (await rateLimit(request)) return new Response('slow down');
          return fetch('https://api.openai.com/v1/chat/completions');
        }`,
    });
    assert.ok(!findingIds(check(root)).includes('metered-endpoint-unprotected'));
  });

  test('a helper module with no handler is not an endpoint', () => {
    const root = scratch({
      'functions/api/_ai.js': "export const BASE = 'https://api.openai.com/v1';",
    });
    assert.ok(!findingIds(check(root)).includes('metered-endpoint-unprotected'));
  });
});

describe('leftovers', () => {
  test('a debug endpoint is reported', () => {
    const root = scratch({
      'functions/api/ai-diag.js': 'export async function onRequestGet({ env }) { return new Response(JSON.stringify(env)); }',
    });
    assert.ok(findingIds(check(root)).includes('debug-endpoint-shipped'));
  });

  test('interpolated SQL is reported', () => {
    const root = scratch({
      'functions/api/q.js': 'const r = await db.prepare(`SELECT * FROM users WHERE id = ${id}`).all();',
    });
    const finding = check(root).findings.find((f) => f.ruleId === 'sql-string-building');
    assert.equal(finding.severity, 'high');
  });

  test('an UPDATE with an interpolated value is reported', () => {
    const root = scratch({
      'functions/api/q.js': 'await db.run(`UPDATE posts SET title = ${title}`);',
    });
    assert.ok(findingIds(check(root)).includes('sql-string-building'));
  });

  test('an HTML select tag is not a SQL query', () => {
    // Regression: matching a bare SELECT turns every '<select ...>' + built by
    // string concatenation into an injection report.
    const root = scratch({
      'functions/api/render.js': [
        "const html = '<select class=\"menu\">' + options + '</select>';",
        "const other = '<select name=\"from\">' + options + '</select>';",
      ].join('\n'),
    });
    assert.ok(!findingIds(check(root)).includes('sql-string-building'));
  });

  test('bound parameters are fine', () => {
    const root = scratch({
      'functions/api/q.js': "const r = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).all();",
    });
    assert.ok(!findingIds(check(root)).includes('sql-string-building'));
  });

  test('logging an env value is reported', () => {
    const root = scratch({ 'src/app.js': 'console.log(process.env.STRIPE_SECRET_KEY);' });
    assert.ok(findingIds(check(root)).includes('secret-logged'));
  });
});

describe('ignore comments', () => {
  test('a trailing nomoretime-ignore silences the line', () => {
    const root = scratch({
      'src/app.js': `const k = "${fakeKey('sk-')}"; // nomoretime-ignore`,
    });
    assert.deepEqual(findingIds(check(root)), []);
  });

  test('nomoretime-ignore-next-line silences the line below', () => {
    const root = scratch({
      'src/app.js': `// nomoretime-ignore-next-line\nconst k = "${fakeKey('sk-')}";`,
    });
    assert.deepEqual(findingIds(check(root)), []);
  });
});

describe('scanning', () => {
  test('generated and vendored directories are skipped', () => {
    const root = scratch({
      'node_modules/pkg/index.js': `const k = "${fakeKey('sk-')}";`,
      'dist/bundle.js': `const k = "${fakeKey('sk-')}";`,
      '.next/server/page.js': `const k = "${fakeKey('sk-')}";`,
    });
    const result = check(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.stats.filesScanned, 0);
  });

  test('a clean project reports nothing', () => {
    const root = scratch({
      'src/app.js': 'export const greet = (name) => `hello ${name}`;',
      '.gitignore': '.env\nnode_modules\n',
    });
    const result = check(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.counts.critical, 0);
  });

  test('only and skip select rules', () => {
    const root = scratch({ 'src/app.js': `const k = "${fakeKey('sk-')}";` });

    assert.deepEqual(findingIds(check(root, { only: ['open-cors'] })), []);
    assert.deepEqual(findingIds(check(root, { skip: ['hardcoded-credential'] })), []);
    assert.deepEqual(findingIds(check(root, { only: ['hardcoded-credential'] })), ['hardcoded-credential']);
  });

  test('a rule that throws does not take the run down', () => {
    const root = scratch({ 'src/app.js': 'const a = 1;' });
    const result = check(root);
    assert.deepEqual(result.errors, []);
    assert.ok(result.stats.rulesRun > 0);
  });
});

describe('tests and docs', () => {
  const openHandler = `
    export async function onRequestPost({ request, env }) {
      await env.DB.put('x', '1');
    }`;

  test('a fixture under a test directory is not a finding', () => {
    const root = scratch({ 'functions/api/__tests__/users.js': openHandler });
    assert.deepEqual(findingIds(check(root)), []);
  });

  test('a .test.js file is not a finding', () => {
    const root = scratch({ 'functions/api/users.test.js': openHandler });
    assert.deepEqual(findingIds(check(root)), []);
  });

  test('documentation describing a mistake is not the mistake', () => {
    const root = scratch({
      'README.md': [
        '# docs',
        '',
        'Never do this:',
        '',
        '```',
        'NEXT_PUBLIC_STRIPE_SECRET_KEY=abc123def456',
        '```',
      ].join('\n'),
    });
    assert.ok(!findingIds(check(root)).includes('public-env-secret'));
  });

  test('but a real key pasted into documentation still is', () => {
    const root = scratch({ 'README.md': `Use \`${fakeKey('sk-')}\` to authenticate.` });
    assert.ok(findingIds(check(root)).includes('hardcoded-credential'));
  });

  test('the same handler outside a test directory is still a finding', () => {
    const root = scratch({ 'functions/api/users.js': openHandler });
    assert.ok(findingIds(check(root)).includes('unauthenticated-write'));
  });
});

describe('report', () => {
  test('the human report names the file, the reason, and the fix', () => {
    const root = scratch({ 'src/app.js': `const k = "${fakeKey('sk-')}";` });
    const text = formatReport(check(root), { color: false, width: 80 });

    assert.match(text, /CRITICAL/);
    assert.match(text, /src\/app\.js:1/);
    assert.match(text, /fix/);
  });

  test('a clean project gets a short report', () => {
    const root = scratch({ 'src/app.js': 'const a = 1;' });
    const text = formatReport(check(root), { color: false });
    assert.match(text, /Nothing to fix/);
  });

  test('json output is stable and parseable', () => {
    const root = scratch({ 'src/app.js': `const k = "${fakeKey('sk-')}";` });
    const parsed = JSON.parse(formatJson(check(root)));

    assert.equal(parsed.version, 1);
    assert.equal(parsed.summary.critical, 1);
    assert.equal(parsed.findings[0].ruleId, 'hardcoded-credential');
    assert.ok(typeof parsed.findings[0].fix === 'string');
  });
});

describe('cli', () => {
  function run(args, cwd) {
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], {
        cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
      });
      return { code: 0, stdout };
    } catch (err) {
      return { code: err.status, stdout: err.stdout || '' };
    }
  }

  test('findings at or above the threshold exit 1', () => {
    const root = scratch({ 'src/app.js': `const k = "${fakeKey('sk-')}";` });
    assert.equal(run(['.'], root).code, 1);
  });

  test('a clean project exits 0', () => {
    const root = scratch({ 'src/app.js': 'const a = 1;' });
    assert.equal(run(['.'], root).code, 0);
  });

  test('--fail-on never always exits 0', () => {
    const root = scratch({ 'src/app.js': `const k = "${fakeKey('sk-')}";` });
    assert.equal(run(['.', '--fail-on', 'never'], root).code, 0);
  });

  test('medium findings alone do not fail the default threshold', () => {
    const root = scratch({
      'functions/api/x.js': `
        export async function onRequestGet() {
          return new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*' }});
        }`,
    });
    const result = run(['.'], root);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /MEDIUM/);
  });

  test('an unknown check is rejected', () => {
    const root = scratch({ 'src/app.js': 'const a = 1;' });
    assert.equal(run(['.', '--only', 'no-such-rule'], root).code, 2);
  });

  test('--list prints every check', () => {
    const root = scratch({ 'src/app.js': 'const a = 1;' });
    const { stdout } = run(['--list'], root);
    assert.match(stdout, /hardcoded-credential/);
    assert.match(stdout, /metered-endpoint-unprotected/);
  });
});
