import {
  SEVERITY, hasAuthSignal, hasRateLimitSignal, callsPaidApiDeep, isIllustrative,
  findingAt, matches,
} from './helpers.js';

const HANDLER_ENTRY = [
  /export\s+(?:async\s+)?function\s+onRequest\w*/,
  /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|handler)\b/,
  /export\s+default\s+(?:async\s+)?function/,
  /\b(?:app|router)\.(?:get|post|put|patch|delete|all)\s*\(/,
  /addEventListener\s*\(\s*['"]fetch['"]/,
  /export\s+default\s*\{[\s\S]{0,80}?fetch\s*[(:]/,
];

/**
 * The bill nobody expects: a public endpoint that forwards to a metered API.
 * The key is on the server, so nothing here is "leaked" -- it is just free for
 * everyone, until the invoice arrives.
 */
export const meteredEndpointUnprotected = {
  id: 'metered-endpoint-unprotected',
  title: 'A public endpoint spends your money on every call',
  check({ files, filesByPath }) {
    const findings = [];

    for (const file of files) {
      if (file.side !== 'server') continue;
      if (isIllustrative(file)) continue;

      const paidHost = callsPaidApiDeep(file, filesByPath);
      if (!paidHost) continue;
      if (hasAuthSignal(file.content) || hasRateLimitSignal(file.content)) continue;

      const entry = HANDLER_ENTRY
        .map((re) => [...matches(file.content, re)][0])
        .find(Boolean);
      if (!entry) continue;

      findings.push(findingAt(file, entry.index, {
        severity: SEVERITY.HIGH,
        message: `${file.relPath} calls ${paidHost} with no auth and no rate limit`,
        why: 'Every request to this URL is a request you pay for. Endpoints like this get found by scanners within days of going live, and the first sign of trouble is usually the invoice.',
        fix: 'Add a per-IP rate limit and require a session before forwarding the call. A spend cap on the provider dashboard is a good second line of defence.',
      }));
    }

    return findings;
  },
};
