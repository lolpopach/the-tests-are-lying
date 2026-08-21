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

/** Assertion shapes across the languages an agent is likely to be writing. */
export const ASSERTION = new RegExp([
  /\bexpect\s*\(/.source,                       // jest, vitest, chai, playwright
  /\bassert(?:Equals?|True|False|That|Raises|Throws|NotNull|Null|Same)?\s*[({]/.source,
  /\bassert\s+/.source,                         // python, rust
  /\.should\b/.source,                          // chai, rspec
  /\bXCTAssert\w*\s*\(/.source,                 // swift
  /\brequire\.\w+\s*\(/.source,                 // testify
  /\bt\.(?:Error|Fatal|Fail)\w*\s*\(/.source,   // go
  /\bEXPECT_\w+\s*\(|\bASSERT_\w+\s*\(/.source, // gtest
  /\bverify\s*\(|\bexpectThrows\s*\(/.source,   // mockito, junit
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
