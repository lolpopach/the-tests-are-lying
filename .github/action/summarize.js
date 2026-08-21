#!/usr/bin/env node
// Turn a report into step outputs. Kept out of action.yml so it can be tested.
import { readFileSync, appendFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const lines = [
  `findings=${report.findings.length}`,
  `lying=${report.summary.lying}`,
  `muted=${report.summary.muted}`,
  `looser=${report.summary.looser}`,
];

// A heredoc delimiter that cannot appear in the body it wraps.
const delimiter = `TAL_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
lines.push(`reply<<${delimiter}`, report.reply, delimiter);

const out = process.env.GITHUB_OUTPUT;
if (out) appendFileSync(out, lines.join('\n') + '\n');
else process.stdout.write(lines.join('\n') + '\n');
