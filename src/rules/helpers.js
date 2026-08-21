/**
 * Three ways a green check stops meaning anything, worst first.
 *
 * The distinction is what the reader actually needs: a tautological assertion
 * and a widened tolerance are both "touched the test", but only one of them
 * has stopped testing entirely.
 */
export const LEVEL = {
  LYING: 'lying',   // the check passes without testing anything
  MUTED: 'muted',   // a real failure exists and is being hidden
  LOOSER: 'looser', // the check still runs, it is just easier to pass
};

export const LEVEL_ORDER = [LEVEL.LYING, LEVEL.MUTED, LEVEL.LOOSER];

/**
 * Assertion shapes across the languages an agent is likely to be writing.
 *
 * `assert.deepEqual(...)` was missing for a long time: the pattern expected a
 * paren straight after the word, so the whole of node:assert, chai and testify
 * went uncounted and a deleted assertion in those suites was silent.
 */
export const ASSERTION = new RegExp([
  /\bexpect\s*\(/.source,                            // jest, vitest, chai, playwright
  /\bassert\s*\.\s*\w+\s*\(/.source,                // node:assert, chai, testify
  /\bassert(?:_?\w+)?\s*!?\s*[({]/.source,            // assert(, assert!(, assert_eq!(, assertEquals(
  /\bassert\s+\S/.source,                            // python, rust: assert x == y
  /->\s*assert\w*\s*\(/.source,                      // phpunit: $this->assertSame(
  /\.should\b|\bshould\s*\.\s*\w+/.source,          // chai, rspec, shouldjs
  /\bXCTAssert\w*\s*\(|\bXCTUnwrap\s*\(/.source,     // swift
  /\brequire\s*\.\s*\w+\s*\(/.source,               // testify require
  /\bt\.(?:Error|Fatal|Fail)\w*\s*\(/.source,        // go
  /\b(?:EXPECT|ASSERT)_\w+\s*\(/.source,             // gtest
  /\bverify\s*\(|\bexpectThrows\s*\(|\bassertThat\s*\(/.source, // mockito, junit
].join('|'));

/** A line whose content is a comment, where `assert` is a word, not a call. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#|<!--|--\s)/;

export function isCommentLine(text) {
  return COMMENT.test(text);
}

export function countAssertions(lines) {
  return lines.filter((l) => !isCommentLine(l.text) && ASSERTION.test(l.text)).length;
}

/**
 * A finding points at a line the reader can open. Removed lines point into the
 * old file, which is the honest thing to do: the code is gone, and saying
 * otherwise sends them to the wrong place.
 */
export function finding(line, fields) {
  return {
    file: line.file.path,
    line: line.line,
    side: line.type === 'del' ? 'removed' : 'added',
    snippet: line.text.trim().slice(0, 120),
    ...fields,
  };
}

/** Match a set of patterns against one line, returning the first label that hits. */
export function firstMatch(text, patterns) {
  for (const [label, re] of patterns) {
    if (re.test(text)) return label;
  }
  return null;
}
