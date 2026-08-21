import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const SKILL = 'the-tests-are-lying';
const SKILL_PATH = `../skills/${SKILL}/SKILL.md`;
const MIRROR_PATH = `../.cursor/skills/${SKILL}/SKILL.md`;

/**
 * The six fields the Agent Skills spec allows. A Claude Code-only field makes
 * packaging for claude.ai and the Skills API fail with a hard error, which
 * would quietly cost the skill most of the places it can run.
 */
const SPEC_FIELDS = new Set([
  'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools',
]);

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(match, 'SKILL.md must open with a --- delimited frontmatter block');

  const fields = {};
  let current = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      assert.ok(current, `indented line with no parent key: ${line}`);
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/);
    assert.ok(kv, `unparseable frontmatter line: ${line}`);
    current = kv[1];
    fields[current] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return { fields, body: text.slice(match[0].length) };
}

describe('skill file', () => {
  const { fields, body } = parseFrontmatter(read(SKILL_PATH));

  test('frontmatter uses only fields the Agent Skills spec allows', () => {
    const extra = Object.keys(fields).filter((k) => !SPEC_FIELDS.has(k));
    assert.deepEqual(extra, [], `these fields break claude.ai packaging: ${extra.join(', ')}`);
  });

  test('name matches the directory', () => {
    assert.equal(fields.name, SKILL);
  });

  test('the description carries the moments the skill has to fire on', () => {
    const d = fields.description.toLowerCase();

    assert.ok(d.length > 80 && d.length < 900, 'too short to distinguish, or long enough to truncate');
    for (const trigger of ['fail', 'test', 'ci', 'done', 'ts-ignore']) {
      assert.ok(d.includes(trigger), `description should mention ${trigger}`);
    }
  });

  test('the scanner is pre-approved so the verify step does not prompt', () => {
    assert.match(fields['allowed-tools'], /Bash\(npx the-tests-are-lying/);
  });

  test('every rule the scanner reports is named in the body', () => {
    // Drift means the agent is warned about something the scanner never
    // raises, or handed a finding it was never told how to read.
    const topics = {
      'deleted assertions': /[Dd]elete an assertion/,
      skips: /\.skip/,
      only: /\.only/,
      tautologies: /toBe\(true\)/,
      suppressions: /@ts-ignore/,
      'swallowed errors': /except: pass/,
      'mocked subjects': /[Mm]ock the thing under test/,
      thresholds: /coverage gate/,
      CI: /continue-on-error/,
    };
    for (const [topic, pattern] of Object.entries(topics)) {
      assert.match(body, pattern, `SKILL.md should cover ${topic}`);
    }
  });

  test('it gives a sanctioned way to be stuck', () => {
    // The reason agents cheat is that "I could not fix it" feels like failure.
    assert.match(body, /stuck/i);
    assert.match(body, /left it failing/i);
  });

  test('it allows changing a test that is genuinely wrong', () => {
    assert.match(body, /When the test really is wrong/);
  });

  test('it tells the agent to run the scanner', () => {
    assert.match(body, /npx the-tests-are-lying/);
  });
});

describe('cursor mirror', () => {
  test('is byte-identical to the source skill', () => {
    assert.ok(existsSync(new URL(MIRROR_PATH, import.meta.url)), 'mirror is missing');
    assert.equal(
      read(MIRROR_PATH),
      read(SKILL_PATH),
      `run: cp skills/${SKILL}/SKILL.md .cursor/skills/${SKILL}/SKILL.md`
    );
  });
});

describe('plugin manifests', () => {
  const plugin = JSON.parse(read('../.claude-plugin/plugin.json'));
  const marketplace = JSON.parse(read('../.claude-plugin/marketplace.json'));
  const pkg = JSON.parse(read('../package.json'));

  test('plugin.json has what a marketplace listing needs', () => {
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

  test('both binary names resolve to the same entry point', () => {
    assert.equal(pkg.bin['the-tests-are-lying'], pkg.bin['tests-are-lying']);
  });
});

describe('documented CLI surface', () => {
  const cli = fileURLToPath(new URL('../bin/tests-are-lying.js', import.meta.url));

  test('every flag the skill and README promise is accepted', () => {
    // If a flag is renamed, the agent follows the skill into an error it
    // cannot diagnose.
    for (const args of [['--help'], ['--list'], ['--version']]) {
      const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
      assert.ok(out.length > 0);
    }
  });

  test('help documents each flag the skill tells the agent to use', () => {
    const help = execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
    for (const flag of ['--reply', '--json', '--fail-on', '--range', '--unstaged', '-C']) {
      assert.ok(help.includes(flag), `--help does not document ${flag}`);
    }
  });
});
