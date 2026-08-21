import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
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

describe('documentation stays true', () => {
  // Both bug classes below shipped. Neither showed up in any test, because
  // tests covered the code and nothing covered the instructions -- which are
  // the part a new user runs first.
  const DOCS = ['../README.md', '../INSTALL.md', '../AGENTS.md'];
  const pkg = JSON.parse(read('../package.json'));
  const slug = pkg.repository.url.replace(/^git\+https:\/\/github\.com\//, '').replace(/\.git$/, '');

  test('every GitHub link points at the current owner and repository', () => {
    // A rename redirects git but not raw.githubusercontent.com, so a stale
    // slug leaves the curl install commands returning 404 and nothing else
    // looking wrong.
    for (const doc of DOCS) {
      const found = read(doc).match(/github(?:usercontent)?\.com\/([\w.-]+\/[\w.-]+)/g) || [];
      for (const url of found) {
        const owner = url.replace(/^github(?:usercontent)?\.com\//, '');
        if (owner.startsWith('anthropics/') || owner.startsWith('agentskills')) continue;
        assert.ok(
          owner.startsWith(slug),
          `${doc} points at ${owner}, but the repository is ${slug}`
        );
      }
    }
  });

  test('the frontmatter-stripping command leaves the rules behind', () => {
    // Documented as two `sed` passes. The first already removes the whole
    // block, so the second deleted through to end of file and the command
    // produced nothing at all.
    const skill = read(SKILL_PATH);
    const lines = skill.split('\n');
    const close = lines.indexOf('---', 1);
    const body = lines.slice(close + 1).join('\n');

    assert.ok(body.trim().length > 500, 'stripping the frontmatter should leave the rules');
    assert.ok(body.includes('## Never'), 'the rules must survive the strip');

    const command = read('../INSTALL.md').match(/sed '1,\/\^---\$\/d'/g) || [];
    assert.equal(command.length, 1, 'one sed pass, not two -- two empties the file');
  });

  test('the install commands name a package that is actually published', () => {
    for (const doc of DOCS) {
      const text = read(doc);
      for (const m of text.match(/npx (?:-y )?([\w@/.-]+)/g) || []) {
        const name = m.replace(/npx (?:-y )?/, '').replace(/@latest$/, '');
        assert.equal(name, pkg.name, `${doc} invokes ${name}, published name is ${pkg.name}`);
      }
    }
  });
});

describe('github action', () => {
  const actionDir = fileURLToPath(new URL('../.github/action/', import.meta.url));
  const reportPath = fileURLToPath(new URL('../.github/action/fixture.tmp.json', import.meta.url));

  const REPORT = {
    version: 1,
    summary: { lying: 1, muted: 1, looser: 0 },
    stats: {},
    findings: [
      { ruleId: 'test-skipped', level: 'muted', file: 'test/a.test.js', line: 4, message: 'This test is skipped (it.skip)' },
      { ruleId: 'ci-always-passes', level: 'lying', file: '.github/workflows/ci.yml', line: 9, message: 'CI cannot fail on this step any more' },
    ],
    errors: [],
    reply: 'You made the checks easier to pass instead of making the code correct.',
  };

  const CLEAN = { version: 1, summary: { lying: 0, muted: 0, looser: 0 }, stats: {}, findings: [], errors: [], reply: 'No checks were weakened in this diff.' };

  function runScript(name, args = [], env = {}) {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [actionDir + name, ...args], {
          encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', ...env },
        }),
      };
    } catch (err) {
      return { code: err.status, stdout: err.stdout || '' };
    }
  }

  function withReport(report, fn) {
    writeFileSync(reportPath, JSON.stringify(report));
    try { return fn(reportPath); } finally { rmSync(reportPath, { force: true }); }
  }

  test('action.yml parses and points at the published package', () => {
    const yml = read('../action.yml');
    assert.match(yml, /using: composite/);
    assert.match(yml, /the-tests-are-lying@\$VERSION/);
    for (const script of ['summarize.js', 'comment.js', 'gate.js']) {
      assert.ok(yml.includes(script), `action.yml should call ${script}`);
      assert.ok(existsSync(actionDir + script), `${script} is missing`);
    }
  });

  test('summarize emits one output per level plus a delimited reply', () => {
    withReport(REPORT, (p) => {
      const { stdout } = runScript('summarize.js', [p]);

      assert.match(stdout, /^findings=2$/m);
      assert.match(stdout, /^lying=1$/m);
      assert.match(stdout, /^muted=1$/m);

      // A fixed delimiter would let a crafted finding forge extra outputs.
      const delimiter = stdout.match(/^reply<<(\S+)$/m);
      assert.ok(delimiter, 'reply must use a heredoc');
      assert.ok(!REPORT.reply.includes(delimiter[1]), 'delimiter must not appear in the body');
    });
  });

  test('the comment body is JSON the API will accept', () => {
    const { stdout } = runScript('comment.js', [], { REPLY: 'line one\n"quoted"\nline three' });
    const parsed = JSON.parse(stdout);

    assert.ok(parsed.body.includes('the-tests-are-lying'));
    assert.ok(parsed.body.includes('"quoted"'), 'quotes must survive, not break the payload');
  });

  test('the gate fails at or above the threshold and passes below it', () => {
    withReport(REPORT, (p) => {
      assert.equal(runScript('gate.js', [p, 'lying']).code, 1);
      assert.equal(runScript('gate.js', [p, 'muted']).code, 1);
      assert.equal(runScript('gate.js', [p, 'never']).code, 0);
      assert.equal(runScript('gate.js', [p, 'nonsense']).code, 2);
    });
  });

  test('a report with only a looser finding does not fail the default gate', () => {
    const looser = { ...CLEAN, summary: { lying: 0, muted: 0, looser: 1 },
      findings: [{ ruleId: 'threshold-loosened', level: 'looser', file: 'jest.config.js', line: 3, message: 'coverage threshold changed from 80 to 40' }] };

    withReport(looser, (p) => {
      assert.equal(runScript('gate.js', [p, 'muted']).code, 0);
      assert.equal(runScript('gate.js', [p, 'looser']).code, 1);
    });
  });

  test('a clean report passes', () => {
    withReport(CLEAN, (p) => assert.equal(runScript('gate.js', [p, 'lying']).code, 0));
  });

  test('the gate annotates each finding where GitHub can render it', () => {
    withReport(REPORT, (p) => {
      const { stdout } = runScript('gate.js', [p, 'muted']);
      assert.match(stdout, /::error file=test\/a\.test\.js,line=4::/);
    });
  });
});
