import { LEVEL, ASSERTION, countAssertions, isCommentLine, finding } from './helpers.js';
import { isTestFile } from '../diff.js';

/**
 * Assertions that left the suite and did not come back.
 *
 * Counted across the whole diff rather than per file, because moving
 * assertions into a shared helper is a normal refactor and reporting it would
 * teach the reader to ignore this tool.
 */
export const assertionDeleted = {
  id: 'assertion-deleted',
  title: 'Assertions were removed and not replaced',
  check({ added, removed }) {
    const removedInTests = removed.filter(
      (l) => isTestFile(l.file.path) && !isCommentLine(l.text) && ASSERTION.test(l.text)
    );
    if (removedInTests.length === 0) return [];

    const net = countAssertions(removed) - countAssertions(added);
    if (net <= 0) return []; // moved, renamed, or rewritten -- not lost

    // Report the ones that went missing, worst case first: a file that lost
    // assertions and gained none is not a refactor.
    const byFile = new Map();
    for (const l of removedInTests) {
      if (!byFile.has(l.file.path)) byFile.set(l.file.path, []);
      byFile.get(l.file.path).push(l);
    }

    const findings = [];
    for (const [path, lines] of byFile) {
      const gained = countAssertions(added.filter((l) => l.file.path === path));
      const lost = lines.length - gained;
      if (lost <= 0) continue;

      findings.push(finding(lines[0], {
        level: LEVEL.LYING,
        message: `${path} lost ${lost} assertion${lost === 1 ? '' : 's'}`,
        why: 'The suite still passes because there is less of it. Removing the assertion that failed is the fastest way to green and the only one that changes nothing about the code.',
        ask: 'Ask what that assertion was checking, and whether the behaviour it covered still works.',
      }));
    }
    return findings;
  },
};

const TAUTOLOGY = [
  /\bexpect\s*\(\s*(true|1|!!1)\s*\)\s*\.\s*(toBe|toEqual|toBeTruthy)\s*\(\s*(true|1)?\s*\)/i,
  // node:assert and chai: assert.ok(true), assert.equal(1, 1), assert.strictEqual(true, true)
  /\bassert\s*\.\s*(?:ok|isOk|isTrue|equal|strictEqual|deepEqual|deepStrictEqual)\s*\(\s*(true|1)\s*(?:,\s*(?:true|1)\s*)?\)/,
  /\bassert\s*\(?\s*(True|true|1)\s*\)?\s*$/,
  /\bassertTrue\s*\(\s*(true|True|1)\s*\)/,
  /\bexpect\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*toBe\s*\(\s*\1\s*\)/, // expect(x).toBe(x)
  /\bassert\s+(\w+)\s*==\s*\1\s*$/,                                     // assert x == x
  /\bXCTAssertTrue\s*\(\s*true\s*\)/,
  /\bt\.(?:True|Equal)\s*\(\s*t\s*,\s*true\s*(?:,\s*true\s*)?\)/,       // testify
];

export const tautologicalAssertion = {
  id: 'tautological-assertion',
  title: 'An assertion was added that cannot fail',
  check({ added }) {
    return added
      .filter((l) => TAUTOLOGY.some((re) => re.test(l.text)))
      .map((l) => finding(l, {
        level: LEVEL.LYING,
        message: 'This assertion passes no matter what the code does',
        why: 'It occupies the place where a real check used to be, so the suite reports the same green with nothing behind it.',
        ask: 'Ask what the original assertion was, and put it back.',
      }));
  },
};

export const testDeleted = {
  id: 'test-deleted',
  title: 'A test file was deleted',
  check({ diff }) {
    return diff.files
      .filter((f) => f.isDeleted && !f.isRename && isTestFile(f.oldPath))
      .map((f) => ({
        file: f.oldPath,
        line: 1,
        side: 'removed',
        snippet: 'file deleted',
        level: LEVEL.LYING,
        message: `${f.oldPath} was deleted`,
        why: 'Everything this file used to check is now unchecked, and nothing in the suite will ever mention it again.',
        ask: 'Ask whether the code it covered was also removed. If it still ships, the tests should too.',
      }));
  },
};

/**
 * A threshold that moved in the direction of passing.
 *
 * Only the cases where the intent is unambiguous: a float comparison that got
 * blunter, a retry budget that grew, a coverage gate that dropped.
 */
const LOOSENED = [
  {
    label: 'float comparison',
    re: /toBeCloseTo\s*\(\s*[^,)]+,\s*(\d+)\s*\)/,
    worse: (before, after) => Number(after) < Number(before), // fewer digits checked
  },
  {
    label: 'coverage threshold',
    re: /(?:branches|functions|lines|statements|fail_under|minimum_coverage)["'\s:=]+(\d+)/i,
    worse: (before, after) => Number(after) < Number(before),
  },
  {
    label: 'retry budget',
    re: /(?:retries|maxRetries|retry_times|attempts)["'\s:=]+(\d+)/i,
    worse: (before, after) => Number(after) > Number(before),
  },
  {
    label: 'timeout',
    re: /(?:timeout|timeoutMs|jest\.setTimeout)\s*[(:=]\s*(\d+)/i,
    worse: (before, after) => Number(after) > Number(before) * 2,
  },
];

export const thresholdLoosened = {
  id: 'threshold-loosened',
  title: 'A threshold moved in the direction of passing',
  check({ diff }) {
    const findings = [];

    for (const file of diff.files) {
      for (const hunk of file.hunks) {
        const removed = hunk.lines.filter((l) => l.type === 'del');
        const added = hunk.lines.filter((l) => l.type === 'add');

        for (const { label, re, worse } of LOOSENED) {
          const before = removed.map((l) => re.exec(l.text)).find(Boolean);
          const afterLine = added.find((l) => re.test(l.text));
          if (!before || !afterLine) continue;

          const after = re.exec(afterLine.text);
          if (!after || !worse(before[1], after[1])) continue;

          findings.push(finding(afterLine, {
            level: LEVEL.LOOSER,
            message: `${label} changed from ${before[1]} to ${after[1]}`,
            why: 'The check still runs. It is just easier to satisfy than it was before this change, and nothing about the code had to improve.',
            ask: 'Ask what failed at the old value.',
          }));
        }
      }
    }
    return findings;
  },
};
