import { LEVEL, finding, firstMatch } from './helpers.js';
import { isTestFile, isCiFile } from '../diff.js';

const SKIPPED = [
  ['it.skip', /\b(?:it|test|describe|context)\s*\.\s*(?:skip|todo|failing)\s*\(/],
  ['xit', /\b(?:xit|xdescribe|xtest|xcontext)\s*\(/],
  ['pytest.mark.skip', /@pytest\.mark\.(?:skip|skipif|xfail)\b/],
  ['unittest.skip', /@unittest\.skip\w*\s*\(/],
  ['@Ignore', /@(?:Ignore|Disabled)\b/],
  ['t.Skip()', /\bt\.Skip(?:Now)?\s*\(/],
  ['#[ignore]', /#\[ignore\]/],
  ['.only', /\b(?:it|test|describe)\s*\.\s*only\s*\(/],
];

export const testSkipped = {
  id: 'test-skipped',
  title: 'A test was switched off',
  check({ added }) {
    return added.flatMap((l) => {
      const label = firstMatch(l.text, SKIPPED);
      if (!label) return [];

      // `.only` is the inverse problem: it silences everything else.
      const isOnly = label === '.only';
      return [finding(l, {
        level: LEVEL.MUTED,
        message: isOnly
          ? 'This narrows the run to one test and skips every other'
          : `This test is skipped (${label})`,
        why: isOnly
          ? 'The suite reports green having run a single case. Left in, it hides every failure in the file from now on.'
          : 'The failure it was catching is still there. Skipping moves it out of sight without moving it out of the code.',
        ask: isOnly
          ? 'Ask for this to come out before the change is merged.'
          : 'Ask what it was failing on. A skip is a bug report someone closed without reading.',
      })];
    });
  },
};

const SUPPRESSED = [
  ['@ts-ignore', /@ts-ignore\b/],
  ['@ts-expect-error', /@ts-expect-error\b/],
  ['@ts-nocheck', /@ts-nocheck\b/],
  ['# type: ignore', /#\s*type:\s*ignore\b/],
  ['eslint-disable', /eslint-disable(?:-next-line|-line)?\b/],
  ['# noqa', /#\s*noqa\b/],
  ['# pylint: disable', /#\s*pylint:\s*disable\b/],
  ['@SuppressWarnings', /@SuppressWarnings\s*\(/],
  ['#pragma warning disable', /#pragma\s+warning\s+disable/],
  ['@ts-ignore (rust)', /#\[allow\(\s*(?:dead_code|unused|warnings)/],
  ['nolint', /\/\/\s*nolint\b/],
];

export const errorSuppressed = {
  id: 'error-suppressed',
  title: 'A compiler or linter complaint was silenced',
  check({ added }) {
    return added.flatMap((l) => {
      const label = firstMatch(l.text, SUPPRESSED);
      if (!label) return [];

      // A suppression carrying a reason is someone making a decision.
      // A bare one is someone making a problem disappear.
      const hasReason = /--\s*\S|:\s*\S{6,}/.test(l.text.replace(label, ''));

      return [finding(l, {
        level: hasReason ? LEVEL.LOOSER : LEVEL.MUTED,
        message: hasReason
          ? `${label} added, with a stated reason`
          : `${label} added with no explanation`,
        why: hasReason
          ? 'Worth a glance to check the reason still holds.'
          : 'The tool found something real and this is the line that stops it being mentioned. The type is still wrong; only the message is gone.',
        ask: 'Ask what the error said. If the answer is vague, the error was never read.',
      })];
    });
  },
};

const SWALLOWED = [
  ['empty catch', /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/],
  ['empty catch', /\.catch\s*\(\s*(?:\([^)]*\)|[\w$]+)?\s*=>\s*\{?\s*\}?\s*\)/],
  ['except: pass', /\bexcept\b[^:]*:\s*pass\b/],
  ['rescue nil', /\brescue\s*(?:=>\s*\w+\s*)?(?:nil|;\s*end)/],
  ['_ = err', /\b_\s*(?::)?=\s*(?:err|error)\b/],
  ['catch returns null', /\btry\s*\{[^}]*\}\s*catch[^{]*\{\s*return\s+(?:null|undefined|nil|None)\s*;?\s*\}/],
];

export const errorSwallowed = {
  id: 'error-swallowed',
  title: 'An error is caught and discarded',
  check({ added }) {
    return added.flatMap((l) => {
      const label = firstMatch(l.text, SWALLOWED);
      if (!label) return [];

      // A swallow wrapped around code that was already there is hiding a
      // failure that already existed. The same line in a hunk of pure new code
      // is a smell for a linter to argue about, and reporting it here would
      // turn this into the general-purpose tool it promises not to be.
      const rewrote = l.hunk && l.hunk.lines.some((x) => x.type === 'del');
      if (!rewrote) return [];

      return [finding(l, {
        level: LEVEL.MUTED,
        message: `Error caught and thrown away (${label})`,
        why: 'The crash stops, so the test goes green, and the thing that was crashing still is. This is the cheapest way to make a failure invisible without fixing it.',
        ask: 'Ask what exception was being thrown. Then ask why it was safe to ignore.',
      })];
    });
  },
};

/**
 * A test file mocking the thing its own name says it tests.
 *
 * `parser.test.js` stubbing `./parser` is not a test of the parser. It is a
 * test of the stub, and it passes by construction.
 */
export const subjectMocked = {
  id: 'subject-mocked',
  title: 'The test mocks the thing it is meant to be testing',
  check({ added }) {
    const MOCK = /\b(?:jest|vi)\s*\.\s*(?:mock|doMock)\s*\(\s*['"]([^'"]+)['"]|\bmock(?:er)?\.patch\s*\(\s*['"]([^'"]+)['"]|\bsinon\s*\.\s*stub\s*\(\s*([\w$.]+)/;

    return added.flatMap((l) => {
      if (!isTestFile(l.file.path)) return [];
      const m = MOCK.exec(l.text);
      if (!m) return [];

      const target = (m[1] || m[2] || m[3] || '').replace(/^.*[/.]/, '').replace(/\.[jt]sx?$/, '');
      const subject = l.file.path
        .replace(/^.*\//, '')
        .replace(/\.(test|spec)\.[jt]sx?$/i, '')
        .replace(/^test_/, '')
        .replace(/_test\.\w+$/, '');

      if (!target || !subject || target.toLowerCase() !== subject.toLowerCase()) return [];

      return [finding(l, {
        level: LEVEL.LYING,
        message: `${l.file.path} mocks ${target}, which is what it tests`,
        why: 'Every assertion in this file now checks the mock. The real implementation could be deleted and the suite would stay green.',
        ask: 'Ask for the real module back, and mock its dependencies instead.',
      })];
    });
  },
};

/**
 * Only patterns whose entire purpose is to stop a failure counting.
 *
 * A bare `-f` matches `rm -f` and `grep -f`; `--force` matches `--force-rm`;
 * `exit 0` ends most shell scripts ever written. Each of those cost a false
 * positive in testing, and a false positive here is worse than a miss --
 * nobody reads the second report from a tool that cried wolf on the first.
 */
const TOOTHLESS_CI = [
  ['|| true', /\|\|\s*true\b/],
  ['continue-on-error', /continue-on-error\s*:\s*true/i],
  ['--passWithNoTests', /--passWithNoTests\b/],
  ['--no-verify', /--no-verify(?![\w-])/],
  ['force push', /\bpush\b[^\n]*--force(?:-with-lease)?(?![\w-])/],
  ['set +e', /\bset\s+\+e\b/],
  ['ignore failures', /\bfailFast\s*:\s*false\b/],
];

export const ciAlwaysPasses = {
  id: 'ci-always-passes',
  title: 'The pipeline was changed to pass regardless',
  check({ added }) {
    return added.flatMap((l) => {
      if (!isCiFile(l.file.path)) return [];
      const label = firstMatch(l.text, TOOTHLESS_CI);
      if (!label) return [];

      return [finding(l, {
        level: LEVEL.LYING,
        message: `CI cannot fail on this step any more (${label})`,
        why: 'The green tick is now unconditional. Everyone downstream reads it as "the tests passed", and it no longer means that.',
        ask: 'Ask which step was failing. Fixing CI config is not fixing the build.',
      })];
    });
  },
};
