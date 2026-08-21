import { SEVERITY, hasAuthSignal, isIllustrative, findingAt, matches } from './helpers.js';

/** Names people give to things they meant to delete before shipping. */
const TEMPORARY_NAME = /(^|[/_-])(debug|diag|diagnostic|dev|test|tmp|temp|scratch|playground|_?internal)([._-]|$)/i;

export const debugEndpointShipped = {
  id: 'debug-endpoint-shipped',
  title: 'A debug endpoint is still deployed',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (file.side !== 'server') continue;
      if (isIllustrative(file)) continue;
      if (!TEMPORARY_NAME.test(file.relPath)) continue;
      if (hasAuthSignal(file.content)) continue;

      findings.push({
        file: file.relPath,
        line: 1,
        snippet: 'reachable over HTTP, no auth check in this file',
        side: 'server',
        severity: SEVERITY.MEDIUM,
        message: `${file.relPath} looks temporary but is live`,
        why: 'Endpoints named debug or diag exist to dump internal state, and this one is served to anyone who guesses the path. They are meant to be removed once the bug is fixed, and they almost never are.',
        fix: 'Delete the file if the problem is solved. If you still need it, put it behind the same auth check as everything else.',
      });
    }

    return findings;
  },
};

/**
 * SQL built by pasting a value straight into the query text.
 *
 * Each verb has to be followed by the clause that makes it SQL -- SELECT by
 * FROM, UPDATE by SET. Matching the bare verb turns every `'<select ...>' +`
 * in a template string into a SQL injection report, and a web app is full of
 * those. The lookbehind drops the HTML tags that survive even that.
 */
const SQL_VERB = String.raw`(?<!<)\b(?:SELECT\b[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE\b[\s\S]*?\bSET|DELETE\s+FROM)\b`;
const SQL_TEMPLATE = new RegExp('`[^`]*' + SQL_VERB + '[^`]*\\$\\{[^`]*`', 'is');
const SQL_CONCAT = new RegExp(`['"][^'"\n]*` + SQL_VERB + `[^'"\n]*['"]\\s*\\+`, 'i');

export const sqlStringBuilding = {
  id: 'sql-string-building',
  title: 'A SQL query is built by string interpolation',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (isIllustrative(file)) continue;

      for (const pattern of [SQL_TEMPLATE, SQL_CONCAT]) {
        const hit = [...matches(file.content, pattern)][0];
        if (!hit) continue;

        findings.push(findingAt(file, hit.index, {
          severity: SEVERITY.HIGH,
          message: 'Query text is assembled from a variable',
          why: 'If any part of that variable comes from a request, the caller is writing your SQL. This is the oldest bug on the web and it still empties databases.',
          fix: 'Use placeholders and bind the value: .prepare("SELECT * FROM t WHERE id = ?").bind(id) rather than putting it in the string.',
        }));
        break; // one report per file is enough to make the point
      }
    }

    return findings;
  },
};

/** Logging a secret writes it into whatever collects your logs. */
const LOGGED_SECRET = /console\.(log|info|warn|debug)\s*\([^)]*\b(?:process\.env|import\.meta\.env)\b[^)]*\)/; // nomoretime-ignore

export const secretLogged = {
  id: 'secret-logged',
  title: 'Environment values are printed to the log',
  check({ files }) {
    const findings = [];

    for (const file of files) {
      if (isIllustrative(file)) continue;

      const hit = [...matches(file.content, LOGGED_SECRET)][0];
      if (!hit) continue;

      const inBrowser = file.side === 'client';
      findings.push(findingAt(file, hit.index, {
        severity: inBrowser ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        message: 'An environment variable is written to the console',
        why: inBrowser
          ? 'This runs in the browser, so the value is printed straight into the visitor devtools console.'
          : 'Server logs get shipped to dashboards, error trackers, and support tickets. A secret that reaches the log is a secret in all of those places.',
        // nomoretime-ignore-next-line -- this advice contains the pattern it warns about
        fix: 'Log whether the value is set, not the value: console.log("API key present:", Boolean(process.env.API_KEY))',
      }));
    }

    return findings;
  },
};
