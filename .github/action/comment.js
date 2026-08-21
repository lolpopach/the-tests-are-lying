#!/usr/bin/env node
// Build the pull request comment body as JSON, so no shell quoting touches it.
const reply = process.env.REPLY || '';

const body = [
  '### the-tests-are-lying',
  '',
  reply,
  '',
  '<sub>Run `npx the-tests-are-lying` locally for the full report, with the',
  'reason each finding matters. Sign off on a deliberate one by putting',
  '`tests-are-lying-ignore` in a comment on that line.</sub>',
].join('\n');

process.stdout.write(JSON.stringify({ body }));
