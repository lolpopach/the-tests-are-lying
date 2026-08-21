import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { inspect } from '../src/index.js';
import { parseDiff } from '../src/diff.js';
import { formatReport, formatReply, formatJson } from '../src/report.js';

const CLI = fileURLToPath(new URL('../bin/tests-are-lying.js', import.meta.url));

/** Build a diff by hand so a test says exactly what it means. */
function diff(path, { removed = [], added = [], context = [], startLine = 1, mode = null, oldPath = null } = {}) {
  const from = oldPath || path;
  const head = [`diff --git a/${from} b/${path}`];
  if (mode === 'new') head.push('new file mode 100644');
  if (mode === 'deleted') head.push('deleted file mode 100644');
  head.push(`--- a/${from}`, `+++ b/${path}`);

  const body = [
    `@@ -${startLine},${removed.length + context.length} +${startLine},${added.length + context.length} @@`,
    ...context.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ];
  return [...head, ...body].join('\n') + '\n';
}

const run = (diffText, options = {}) => inspect('/nonexistent', { diffText, ...options });
const ids = (result) => result.findings.map((f) => f.ruleId);
const levels = (result) => Object.fromEntries(
  result.findings.map((f) => [f.ruleId, f.level])
);

describe('diff parsing', () => {
  test('added lines carry their new line number', () => {
    const parsed = parseDiff(diff('a.js', { context: ['one'], added: ['two'], startLine: 10 }));
    const added = parsed.files[0].hunks[0].lines.filter((l) => l.type === 'add');

    assert.equal(added[0].line, 11);
    assert.equal(added[0].text, 'two');
  });

  test('removed lines carry their old line number', () => {
    const parsed = parseDiff(diff('a.js', { context: ['one'], removed: ['gone'], startLine: 40 }));
    const removed = parsed.files[0].hunks[0].lines.filter((l) => l.type === 'del');

    assert.equal(removed[0].line, 41);
  });

  test('a rename is not a new file and not a deletion', () => {
    const parsed = parseDiff(diff('test/new.test.js', { oldPath: 'test/old.test.js', context: ['x'] }));

    assert.equal(parsed.files[0].isRename, true);
    assert.equal(parsed.files[0].isDeleted, false);
  });

  test('an empty diff parses to nothing', () => {
    assert.deepEqual(parseDiff('').files, []);
    assert.deepEqual(run('').findings, []);
  });
});

describe('deleted assertions', () => {
  test('a test file that loses an assertion is reported', () => {
    const result = run(diff('test/parser.test.js', {
      removed: ["  expect(parse('a,b')).toEqual(['a','b']);"],
      added: ['  // covered elsewhere'],
    }));

    assert.ok(ids(result).includes('assertion-deleted'));
    assert.equal(levels(result)['assertion-deleted'], 'lying');
  });

  test('assertions moved to a helper are not lost', () => {
    // Same count out and in, in two different files: a refactor, not a retreat.
    const text =
      diff('test/parser.test.js', { removed: ["  expect(a).toBe(1);", "  expect(b).toBe(2);"] }) +
      diff('test/helpers.js', { added: ["  expect(a).toBe(1);", "  expect(b).toBe(2);"] });

    assert.ok(!ids(run(text)).includes('assertion-deleted'));
  });

  test('a rewritten assertion is not a removed one', () => {
    const result = run(diff('test/parser.test.js', {
      removed: ["  expect(parse('a')).toEqual(['a']);"],
      added: ["  expect(parse('a')).toStrictEqual(['a']);"],
    }));

    assert.ok(!ids(result).includes('assertion-deleted'));
  });

  test('assertions removed from non-test files are ignored', () => {
    const result = run(diff('src/parser.js', { removed: ['  assert(x > 0);'] }));
    assert.ok(!ids(result).includes('assertion-deleted'));
  });

  test('a deleted test file is reported', () => {
    const result = run(diff('test/parser.test.js', {
      mode: 'deleted',
      removed: ["test('x', () => {});"],
    }));

    assert.ok(ids(result).includes('test-deleted'));
    assert.equal(levels(result)['test-deleted'], 'lying');
  });

  test('a renamed test file is not a deleted one', () => {
    const result = run(diff('test/new.test.js', { oldPath: 'test/old.test.js', context: ['x'] }));
    assert.ok(!ids(result).includes('test-deleted'));
  });
});

describe('tautological assertions', () => {
  const cases = [
    'expect(true).toBe(true);',
    'assert.ok(true);',
    'assert.strictEqual(true, true);',
    'assert True',
    'assertTrue(true);',
    'expect(result).toBe(result);',
    'XCTAssertTrue(true)',
  ];

  for (const line of cases) {
    test(`catches: ${line}`, () => {
      const result = run(diff('test/a.test.js', { added: ['  ' + line] }));
      assert.ok(ids(result).includes('tautological-assertion'), `missed: ${line}`);
    });
  }

  test('a real assertion is not a tautology', () => {
    const result = run(diff('test/a.test.js', {
      added: ['  expect(parse(input)).toEqual(expected);', '  assert.ok(result.length > 0);'],
    }));
    assert.ok(!ids(result).includes('tautological-assertion'));
  });
});

describe('switched-off tests', () => {
  const cases = [
    ["test.skip('x', () => {});", 'test-skipped'],
    ["it.skip('x', () => {});", 'test-skipped'],
    ["xit('x', () => {});", 'test-skipped'],
    ['@pytest.mark.skip', 'test-skipped'],
    ['@unittest.skip("broken")', 'test-skipped'],
    ['t.Skip("flaky")', 'test-skipped'],
    ['#[ignore]', 'test-skipped'],
  ];

  for (const [line, id] of cases) {
    test(`catches: ${line}`, () => {
      assert.ok(ids(run(diff('test/a.test.js', { added: ['  ' + line] }))).includes(id), `missed: ${line}`);
    });
  }

  test('.only is reported as hiding everything else', () => {
    const result = run(diff('test/a.test.js', { added: ["it.only('just this', () => {});"] }));
    const found = result.findings.find((f) => f.ruleId === 'test-skipped');

    assert.ok(found);
    assert.match(found.message, /narrows the run/);
  });

  test('an existing skip in context is not an added one', () => {
    const result = run(diff('test/a.test.js', {
      context: ["it.skip('known broken', () => {});"],
      added: ['  const x = 1;'],
    }));
    assert.ok(!ids(result).includes('test-skipped'));
  });
});

describe('suppressed errors', () => {
  test('a bare suppression is muted', () => {
    const result = run(diff('src/a.ts', { added: ['  // @ts-ignore'] }));
    assert.equal(levels(result)['error-suppressed'], 'muted');
  });

  test('a suppression with a reason is only looser', () => {
    const result = run(diff('src/a.ts', {
      added: ['  // @ts-ignore -- upstream types are wrong, see DefinitelyTyped#4021'],
    }));
    assert.equal(levels(result)['error-suppressed'], 'looser');
  });

  for (const line of ['# type: ignore', '// eslint-disable-next-line', '# noqa', '@SuppressWarnings("all")']) {
    test(`catches: ${line}`, () => {
      assert.ok(ids(run(diff('src/a.py', { added: ['  ' + line] }))).includes('error-suppressed'));
    });
  }
});

describe('swallowed errors', () => {
  for (const line of ['} catch (e) {}', '} catch {}', 'except ValueError: pass', '.catch(() => {})']) {
    test(`catches: ${line}`, () => {
      const text = diff('src/a.js', { removed: ['  doTheThing();'], added: ['  ' + line] });
      assert.ok(ids(run(text)).includes('error-swallowed'), `missed: ${line}`);
    });
  }

  test('a swallow in brand new code is left to the linters', () => {
    // The thesis is "did this diff weaken a check", not "is this line tidy".
    const result = run(diff('src/new-feature.js', { added: ['  } catch (e) {}'] }));
    assert.deepEqual(ids(result), []);
  });

  test('an error that gets handled is not swallowed', () => {
    const result = run(diff('src/a.js', {
      added: ['} catch (e) {', '  logger.error(e);', '  throw e;', '}'],
    }));
    assert.ok(!ids(result).includes('error-swallowed'));
  });
});

describe('mocking the subject', () => {
  test('a test that mocks its own subject is reported', () => {
    const result = run(diff('test/parser.test.js', { added: ["jest.mock('../src/parser');"] }));

    assert.ok(ids(result).includes('subject-mocked'));
    assert.equal(levels(result)['subject-mocked'], 'lying');
  });

  test('mocking a dependency is normal', () => {
    const result = run(diff('test/parser.test.js', { added: ["jest.mock('../src/database');"] }));
    assert.ok(!ids(result).includes('subject-mocked'));
  });

  test('a mock outside a test file is not this rule', () => {
    const result = run(diff('src/parser.js', { added: ["jest.mock('../src/parser');"] }));
    assert.ok(!ids(result).includes('subject-mocked'));
  });
});

describe('toothless CI', () => {
  for (const line of ['continue-on-error: true', 'run: node --test || true', 'set +e']) {
    test(`catches: ${line}`, () => {
      const result = run(diff('.github/workflows/ci.yml', { added: ['      ' + line] }));
      assert.ok(ids(result).includes('ci-always-passes'), `missed: ${line}`);
    });
  }

  test('the same text in application code is not a CI change', () => {
    const result = run(diff('src/shell.js', { added: ["  exec('build || true');"] }));
    assert.ok(!ids(result).includes('ci-always-passes'));
  });

  test('--no-verify in a hook is reported', () => {
    const result = run(diff('.husky/pre-push', { added: ['git push --no-verify'] }));
    assert.ok(ids(result).includes('ci-always-passes'));
  });
});

describe('loosened thresholds', () => {
  test('a float comparison that got blunter is reported', () => {
    const result = run(diff('test/math.test.js', {
      removed: ['  expect(value).toBeCloseTo(3.14159, 5);'],
      added: ['  expect(value).toBeCloseTo(3.14159, 1);'],
    }));

    assert.ok(ids(result).includes('threshold-loosened'));
    assert.equal(levels(result)['threshold-loosened'], 'looser');
  });

  test('a coverage gate that dropped is reported', () => {
    const result = run(diff('jest.config.js', {
      removed: ['      branches: 80,'],
      added: ['      branches: 40,'],
    }));
    assert.ok(ids(result).includes('threshold-loosened'));
  });

  test('a threshold that got stricter is not', () => {
    const result = run(diff('jest.config.js', {
      removed: ['      branches: 40,'],
      added: ['      branches: 80,'],
    }));
    assert.ok(!ids(result).includes('threshold-loosened'));
  });
});

describe('signing off deliberately', () => {
  test('tests-are-lying-ignore silences a line', () => {
    const result = run(diff('test/a.test.js', {
      added: ["it.skip('flaky on CI, see #412', () => {}); // tests-are-lying-ignore"],
    }));
    assert.deepEqual(result.findings, []);
  });
});

describe('rule selection', () => {
  const text = diff('test/a.test.js', { added: ["it.skip('x', () => {});"] });

  test('only runs the named checks', () => {
    assert.deepEqual(ids(run(text, { only: ['ci-always-passes'] })), []);
    assert.deepEqual(ids(run(text, { only: ['test-skipped'] })), ['test-skipped']);
  });

  test('skip drops the named checks', () => {
    assert.deepEqual(ids(run(text, { skip: ['test-skipped'] })), []);
  });

  test('a rule that throws does not take the run down', () => {
    assert.deepEqual(run(text).errors, []);
  });
});

describe('report', () => {
  const text =
    diff('test/a.test.js', { added: ["  expect(true).toBe(true);"] }) +
    diff('src/a.ts', { added: ['  // @ts-ignore'] });

  test('names the level, the file, and what to ask', () => {
    const out = formatReport(run(text), { color: false, width: 80 });

    assert.match(out, /LYING/);
    assert.match(out, /test\/a\.test\.js:1/);
    assert.match(out, /ask/);
  });

  test('a clean diff gets one line', () => {
    const out = formatReport(run(''), { color: false });
    assert.match(out, /Nothing weakened/);
  });

  test('the reply is addressed to whoever wrote the diff', () => {
    const reply = formatReply(run(text));

    assert.match(reply, /You made the checks easier to pass/);
    assert.match(reply, /test\/a\.test\.js:1/);
    assert.match(reply, /Do not report this as passing/);
  });

  test('the reply says so when nothing is wrong', () => {
    assert.match(formatReply(run('')), /No checks were weakened/);
  });

  test('json carries the reply so an agent gets both at once', () => {
    const parsed = JSON.parse(formatJson(run(text)));

    assert.equal(parsed.version, 1);
    assert.equal(parsed.summary.lying, 1);
    assert.ok(parsed.reply.includes('easier to pass'));
  });
});

describe('cli', () => {
  const cleanup = [];
  test.after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

  /** A git repo with `before` committed and `after` staged. */
  function repo(before, after) {
    const dir = mkdtempSync(join(tmpdir(), 'lying-'));
    cleanup.push(dir);
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    const write = (files) => {
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
      }
    };

    write(before);
    git('init', '-q');
    git('config', 'user.email', 't@e.com');
    git('config', 'user.name', 't');
    git('add', '-A');
    git('commit', '-qm', 'before');
    write(after);
    git('add', '-A');
    return dir;
  }

  function cli(dir, args = []) {
    try {
      const stdout = execFileSync(process.execPath, [CLI, '-C', dir, ...args], {
        encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
      });
      return { code: 0, stdout };
    } catch (err) {
      return { code: err.status, stdout: err.stdout || '' };
    }
  }

  const HONEST = { 'test/a.test.js': "test('x', () => { assert.equal(f(), 1); });\n" };
  const CHEATING = { 'test/a.test.js': "test.skip('x', () => { assert.equal(f(), 1); });\n" };

  test('a weakened diff exits 1', () => {
    assert.equal(cli(repo(HONEST, CHEATING)).code, 1);
  });

  test('an honest diff exits 0', () => {
    const dir = repo(HONEST, { 'test/a.test.js': "test('x', () => { assert.equal(f(), 2); });\n" });
    const { code, stdout } = cli(dir);
    assert.equal(code, 0, stdout);
  });

  test('--fail-on never always exits 0', () => {
    assert.equal(cli(repo(HONEST, CHEATING), ['--fail-on', 'never']).code, 0);
  });

  test('--fail-on lying ignores a merely muted finding', () => {
    assert.equal(cli(repo(HONEST, CHEATING), ['--fail-on', 'lying']).code, 0);
  });

  test('--reply prints the message for the agent', () => {
    const { stdout } = cli(repo(HONEST, CHEATING), ['--reply']);
    assert.match(stdout, /easier to pass/);
  });

  test('--json parses', () => {
    const { stdout } = cli(repo(HONEST, CHEATING), ['--json']);
    assert.equal(JSON.parse(stdout).summary.muted, 1);
  });

  test('--list prints every check', () => {
    const { stdout } = cli(repo(HONEST, HONEST), ['--list']);
    assert.match(stdout, /test-skipped/);
    assert.match(stdout, /ci-always-passes/);
  });

  test('a bad flag exits 2', () => {
    assert.equal(cli(repo(HONEST, HONEST), ['--nope']).code, 2);
    assert.equal(cli(repo(HONEST, HONEST), ['--fail-on', 'wrong']).code, 2);
  });

  test('outside a git repo it says so instead of crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nogit-'));
    cleanup.push(dir);
    assert.equal(cli(dir).code, 2);
  });
});

describe('false positives found by attacking it', () => {
  // Each of these shipped as a real false positive during review. They are the
  // reason this tool is worth installing rather than uninstalling.

  test('ordinary shell in a CI file is not a weakened pipeline', () => {
    for (const line of [
      '      - run: rm -f dist/*.log',
      '      - run: docker build --force-rm .',
      '      - run: grep -f patterns.txt src/',
      'exit 0',
    ]) {
      const result = run(diff('.github/workflows/ci.yml', { added: [line] }));
      assert.deepEqual(ids(result), [], `false positive on: ${line}`);
    }
  });

  test('a force push is still caught', () => {
    const result = run(diff('.husky/pre-push', { added: ['git push --force origin main'] }));
    assert.ok(ids(result).includes('ci-always-passes'));
  });

  test('prose containing the word assert is not an assertion', () => {
    const result = run(diff('test/a.test.js', {
      removed: ['  // we assert that the parser is total', '  # assert the shape is right'],
    }));
    assert.deepEqual(ids(result), []);
  });

  test('a commented-out assertion is not a live one', () => {
    const result = run(diff('test/a.test.js', {
      removed: ['  // expect(old).toBe(1);'],
      added: ['  expect(next).toBe(2);'],
    }));
    assert.deepEqual(ids(result), []);
  });

  test('python test files are recognised wherever they live', () => {
    const result = run(diff('src/test_parser.py', {
      removed: ['    assert parse("a") == ["a"]'],
      added: ['    pass'],
    }));
    assert.ok(ids(result).includes('assertion-deleted'), 'src/test_*.py should count as a test file');
  });
});
