#!/usr/bin/env node
// Decide whether the job fails, from the report rather than a second scan.
import { readFileSync } from 'node:fs';

const ORDER = ['lying', 'muted', 'looser'];
const [, , path, failOn = 'muted'] = process.argv;

if (failOn === 'never') process.exit(0);
if (!ORDER.includes(failOn)) {
  console.error(`::error::fail-on must be one of: ${ORDER.join(', ')}, never`);
  process.exit(2);
}

const report = JSON.parse(readFileSync(path, 'utf8'));
const threshold = ORDER.indexOf(failOn);
const blocking = report.findings.filter((f) => ORDER.indexOf(f.level) <= threshold);

if (blocking.length === 0) process.exit(0);

for (const f of blocking) {
  console.log(`::error file=${f.file},line=${f.line}::${f.message}`);
}
console.error(
  `::error::${blocking.length} change${blocking.length === 1 ? '' : 's'} made the checks easier to pass. ` +
  'A green run on this diff proves nothing.'
);
process.exit(1);
