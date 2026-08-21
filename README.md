# nomoretime

**You vibe-coded an app. Run this before you ship it.**

One command. No config, no signup, no API key, no dependencies. It looks for the
handful of mistakes that turn a working prototype into a leaked key, an open
database, or a surprise invoice — and it tells you what to do about each one in
plain language.

```bash
npx nomoretime
```

```
  nomoretime  7 files checked in 0.0s

  CRITICAL  3
  ------------------------------------------------------------------------------

  !  NEXT_PUBLIC_OPENAI_API_KEY is inlined into the browser bundle
     .env.local:1  ·  public-env-secret

     NEXT_PUBLIC_OPENAI_API_KEY=sk-pro...Rw

     Your bundler replaces every NEXT_PUBLIC_* variable with its literal value
     at build time. The value ends up in the JavaScript you serve, so it is
     public the moment you deploy.

     fix  Drop the NEXT_PUBLIC_ prefix and read this variable on the server. If the
          browser genuinely needs the result, put a small API route in front of it.

  !  firestore.rules grants access to everyone
     firestore.rules:4  ·  firebase-open-rules

     allow read, write: if true;

     These rules are the only thing between the public internet and your
     database. `if true` means there is nothing between them.

     fix  Scope each rule to the signed-in owner, e.g. `allow read, write: if
          request.auth != null && request.auth.uid == userId;`

  HIGH  3
  ------------------------------------------------------------------------------

  *  app/api/chat/route.js calls api.openai.com with no auth and no rate limit
     app/api/chat/route.js:1  ·  metered-endpoint-unprotected

     export async function POST(request) {

     Every request to this URL is a request you pay for. Endpoints like this get
     found by scanners within days of going live, and the first sign of trouble
     is usually the invoice.

     fix  Add a per-IP rate limit and require a session before forwarding the call. A
          spend cap on the provider dashboard is a good second line of defence.

  ------------------------------------------------------------------------------
  3 critical  ·  3 high  ·  1 medium

  Treat every critical finding as already leaked: rotate the key first, then fix the code.
```

## Why this exists

Veracode's [2025 GenAI Code Security Report](https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/)
ran 80 coding tasks through more than 100 models. **45% of the generated code
introduced an OWASP Top 10 vulnerability.** Newer and larger models did not
score better than smaller ones — this is structural, not a gap the next release
closes.

That number is only half the problem. The other half is that the person shipping
the code increasingly did not write it, and so has no idea which twelve things
to check before it goes live. The code runs. The demo works. Nothing looks
wrong, because nothing looks like anything.

`nomoretime` is the checklist, as a command.

## What it is not

A general-purpose security scanner. Those exist, they are good, and they will
hand you six hundred findings you will not read.

This one only knows about mistakes that are **specific to how AI-assisted code
gets built and shipped**, and it tries hard to stay quiet otherwise. Every
finding has to earn its line: if you run this and the output is noise, the tool
has failed, not you.

Once you outgrow it, run [gitleaks](https://github.com/gitleaks/gitleaks),
[semgrep](https://github.com/semgrep/semgrep), or `npm audit` alongside it.

## What it checks

| Check | Finds |
|---|---|
| `public-env-secret` | A real secret behind `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_`, which the bundler pastes into your JavaScript at build time |
| `hardcoded-credential` | Live-looking OpenAI, Anthropic, Google, AWS, GitHub, Slack, Stripe, SendGrid, Telegram keys and private key blocks, written straight into source |
| `env-committed` | A `.env` that git is already tracking |
| `firebase-open-rules` | Firestore, Storage, or RTDB rules that resolve to `if true` |
| `metered-endpoint-unprotected` | A public endpoint that forwards to a billed API with no auth and no rate limit — including when the call sits in a helper module it imports |
| `unauthenticated-write` | A handler that writes stored data without looking at a session, token, or cookie first |
| `sql-string-building` | Query text assembled by interpolation instead of bound parameters |
| `open-cors` | `Access-Control-Allow-Origin: *`, graded by what the endpoint actually does |
| `secret-logged` | `console.log(process.env.…)` shipping a secret into your logs |
| `debug-endpoint-shipped` | A route named `debug` / `diag` / `tmp` that is still live and still unauthenticated |
| `gitignore-missing-env` | A `.env` that is not committed yet and nothing is stopping it |

`npx nomoretime --list` prints these at any time.

## Design rules

The whole tool is built around not wasting your attention.

**A secret is never echoed back.** Findings quote the offending line with the
value redacted. A tool that prints your key into a CI log has leaked it a second
time, somewhere with a longer memory.

**Placeholders are not findings.** `sk-your-key-here`, `<YOUR_TOKEN>`,
`sk-xxxxxxxx` and friends are skipped. So are lockfiles, `node_modules`,
`dist`, and every other generated directory.

**Public-by-design keys are left alone.** A Supabase anon key, a Firebase web
API key, and a reCAPTCHA site key all *look* like secrets and are meant to be in
your bundle. Supabase `service_role` keys look identical to anon keys and are
not — so the JWT's `role` claim is what gets checked, not the variable name.

**Where a file runs decides how bad it is.** The same hardcoded key is
`critical` in browser code and `high` on a server. When the tool cannot tell
which side a file runs on, it declines to guess rather than inventing a
critical.

**Outbound credentials are not inbound checks.** `Authorization: Bearer ${key}`
on a `fetch` is your server *spending* a credential, not guarding an endpoint.
Reading that as "this route is authenticated" would wave through exactly the
wide-open AI proxies this tool exists to find.

## Usage

```bash
npx nomoretime                    # check the current directory
npx nomoretime ./apps/web         # check somewhere else
npx nomoretime --json             # machine-readable
npx nomoretime --list             # every check and what it finds
```

| Option | |
|---|---|
| `--fail-on <level>` | Exit 1 at this severity or worse. `critical`, `high` (default), `medium`, `never` |
| `--only <ids>` | Run just these checks, comma separated |
| `--skip <ids>` | Run everything except these |
| `--json` | JSON on stdout |
| `--no-color` | Plain text |

Exit code is `0` when nothing at or above the threshold was found, `1` when
something was, and `2` when you gave it a bad argument — so it drops into CI
without a wrapper.

### In CI

```yaml
- run: npx nomoretime --fail-on critical
```

### As a pre-push hook

```bash
echo 'npx nomoretime --fail-on critical' >> .husky/pre-push
```

### Silencing a line

Sometimes you really did mean it.

```js
const DEMO_KEY = "sk-not-a-real-key-just-for-the-docs"; // nomoretime-ignore
```

```js
// nomoretime-ignore-next-line
const DEMO_KEY = "sk-not-a-real-key-just-for-the-docs";
```

## Programmatic use

```js
import { check } from 'nomoretime';

const { findings, counts } = check(process.cwd());
if (counts.critical > 0) process.exit(1);
```

Each finding is `{ ruleId, severity, file, line, snippet, message, why, fix }`.

## False positives

They are bugs, and they are the bugs that matter most here — one bad finding
costs more trust than five good ones earn. If this tool flags something correct,
[open an issue](https://github.com/lolpopa360/nomoretime/issues) with the
pattern that tripped it and it gets fixed.

## Contributing

```bash
git clone https://github.com/lolpopa360/nomoretime
cd nomoretime
node --test
```

No build step, no dependencies, Node 18+. A new check is one file in
`src/rules/` exporting `{ id, title, check(context) }`, added to the list in
`src/rules/index.js`. Bring tests for both the case it should catch and the case
it should stay quiet on — the second one is the harder half.

## License

MIT
