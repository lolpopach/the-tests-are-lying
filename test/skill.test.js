import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const SKILL = 'nomoretime';
const SKILL_PATH = `../skills/${SKILL}/SKILL.md`;
const MIRROR_PATH = `../.cursor/skills/${SKILL}/SKILL.md`;

/**
 * The six fields the Agent Skills spec allows. Anything else is a Claude Code
 * extension, and including one makes the skill fail to package for claude.ai
 * and the Skills API -- which is exactly the portability this repo advertises.
 */
const SPEC_FIELDS = new Set([
  'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools',
]);

/** Enough YAML for frontmatter: top-level scalars and one level of nesting. */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'SKILL.md must open with a --- delimited frontmatter block');

  const fields = {};
  let current = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      assert.ok(current, `indented line with no parent key: ${line}`);
      fields[current].nested.push(line.trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/);
    assert.ok(kv, `unparseable frontmatter line: ${line}`);
    current = kv[1];
    fields[current] = { value: kv[2].trim().replace(/^['"]|['"]$/g, ''), nested: [] };
  }
  return { fields, body: text.slice(match[0].length) };
}

describe('skill file', () => {
  const { fields, body } = parseFrontmatter(read(SKILL_PATH));

  test('frontmatter uses only fields the Agent Skills spec allows', () => {
    const extra = Object.keys(fields).filter((k) => !SPEC_FIELDS.has(k));
    assert.deepEqual(extra, [], `these fields break claude.ai packaging: ${extra.join(', ')}`);
  });

  test('name matches the directory the skill lives in', () => {
    assert.equal(fields.name.value, SKILL);
  });

  test('the description carries the triggers Claude matches on', () => {
    const description = fields.description.value.toLowerCase();

    assert.ok(description.length > 80, 'too short to distinguish from other skills');
    // description and when_to_use are truncated together at 1536 characters.
    assert.ok(description.length < 900, 'long enough to risk truncation in the listing');

    for (const trigger of ['deploy', 'api', 'auth', '.env', 'cors']) {
      assert.ok(description.includes(trigger), `description should mention ${trigger}`);
    }
  });

  test('the scanner is pre-approved so the verify step does not prompt', () => {
    assert.match(fields['allowed-tools'].value, /Bash\(npx nomoretime/);
  });

  test('the body tells the agent to verify rather than assert', () => {
    assert.match(body, /npx nomoretime/);
    assert.match(body, /rotate/i, 'a relocated key is still a leaked key');
  });

  test('the body covers every check the scanner can report', () => {
    // Drift here means the agent is told to trust a report it was never
    // prepared for, or warned about something the scanner never raises.
    const topics = {
      'public prefix': /NEXT_PUBLIC_/,
      'hardcoded credential': /service_role/,
      'open write endpoint': /401/,
      'metered API': /rate limit/i,
      CORS: /Access-Control-Allow-Origin/,
      'database rules': /allow read, write/,
      SQL: /\.bind\(/,
      logging: /console\.log/,
      'debug routes': /\bdiag\b/,
    };
    for (const [topic, pattern] of Object.entries(topics)) {
      assert.match(body, pattern, `SKILL.md should cover ${topic}`);
    }
  });

  test('it tells the agent what NOT to warn about', () => {
    for (const safe of ['anon', 'reCAPTCHA', 'publishable']) {
      assert.ok(body.includes(safe), `false-alarm list should mention ${safe}`);
    }
  });
});

describe('cursor mirror', () => {
  test('is byte-identical to the source skill', () => {
    assert.ok(existsSync(new URL(MIRROR_PATH, import.meta.url)), 'mirror is missing');
    assert.equal(
      read(MIRROR_PATH),
      read(SKILL_PATH),
      'run: cp skills/nomoretime/SKILL.md .cursor/skills/nomoretime/SKILL.md'
    );
  });
});

describe('plugin manifests', () => {
  const plugin = JSON.parse(read('../.claude-plugin/plugin.json'));
  const marketplace = JSON.parse(read('../.claude-plugin/marketplace.json'));
  const pkg = JSON.parse(read('../package.json'));

  test('plugin.json has the fields a marketplace listing needs', () => {
    for (const field of ['name', 'version', 'description', 'author', 'license', 'repository']) {
      assert.ok(plugin[field], `plugin.json is missing ${field}`);
    }
    assert.equal(plugin.name, SKILL);
  });

  test('the plugin version tracks the package version', () => {
    assert.equal(plugin.version, pkg.version, 'bump both or neither');
  });

  test('marketplace.json points at a plugin that exists here', () => {
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, plugin.name);
    assert.equal(marketplace.plugins[0].source, './');
  });
});

describe('documented CLI surface', () => {
  const cli = fileURLToPath(new URL('../bin/nomoretime.js', import.meta.url));
  const run = (args) => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [cli, ...args], {
        cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
      }) };
    } catch (err) {
      return { code: err.status, stdout: err.stdout || '' };
    }
  };

  test('every flag the skill and docs promise is accepted', () => {
    // The skill tells the agent these exist. If a flag is renamed, the agent
    // follows the instruction into an error it cannot diagnose.
    for (const args of [['--json'], ['--fail-on', 'critical'], ['--list'], ['--help']]) {
      const { code } = run(args);
      assert.notEqual(code, 2, `${args.join(' ')} was rejected as a bad argument`);
    }
  });

  test('the repository passes its own checks', () => {
    const { code, stdout } = run(['.']);
    assert.equal(code, 0, `nomoretime reports findings against itself:\n${stdout}`);
  });
});
