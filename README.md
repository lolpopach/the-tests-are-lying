<p align="center">
  <strong>Your agent writes the code. This stops it shipping your API key.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/lolpopa360/nomoretime?style=flat" alt="License"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-blue?style=flat" alt="Node 18+">
</p>

## Install

Paste into your assistant:

```text
Install the nomoretime skill from https://github.com/lolpopa360/nomoretime,
following the repo's AGENTS.md.
```

Or, in Claude Code:

```bash
claude plugin marketplace add lolpopa360/nomoretime
claude plugin install nomoretime@nomoretime
```

Cursor, claude.ai, Gemini CLI and everything else: [INSTALL.md](INSTALL.md).

## What it does

A skill for your coding assistant that stops it shipping the nine mistakes that
leak keys, open databases, and run up bills — then makes it **prove** the code
is clean instead of telling you it looks fine.

## What changes

<table>
<tr>
<td width="50%">

### Before

> **You:** the frontend can't read my OpenAI key, fix it
>
> **Agent:** The issue is that environment variables aren't exposed to the
> browser by default. I've renamed it to `NEXT_PUBLIC_OPENAI_API_KEY` in your
> `.env.local` and updated the reference in `components/Chat.tsx`. The key is
> now accessible from client-side code and your chat feature should work.
> Let me know if you need anything else!

</td>
<td width="50%">

### After

> **You:** the frontend can't read my OpenAI key, fix it
>
> **Agent:** Not with a `NEXT_PUBLIC_` prefix — the bundler pastes the value
> straight into the JavaScript you serve, so the key would be readable by
> anyone who opens the site.
>
> 1. Moved the call into `app/api/chat/route.js`
> 2. `components/Chat.tsx` now posts there instead
> 3. Key stays `OPENAI_API_KEY`, server-side only
>
> Ran `npx nomoretime` — clean. Added a per-IP rate limit on that route so a
> public endpoint can't drain your credits.

</td>
</tr>
</table>

## Why bother

Veracode's [2025 GenAI Code Security Report](https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/)
ran 80 coding tasks through more than 100 models. **45% of the generated code
introduced an OWASP Top 10 vulnerability.** Larger and newer models did not
score better — this is structural, not something the next release fixes.

The other half of the problem is that the person shipping the code increasingly
did not write it, and so cannot tell which twelve things to check. The app runs.
The demo works. Nothing looks wrong, because nothing looks like anything.

## It verifies, it doesn't vibe

Most security skills are a prompt asking the model to be careful. A model asked
to be careful will cheerfully report *"I've reviewed the code and it looks
secure"* about a file with a live key in it.

This one ends every job by running a real scanner:

```bash
npx nomoretime
```

Eleven deterministic checks, no config, no signup, no API key, no network, no
dependencies. Exit `1` if anything at high severity or above is still there. The
agent cannot talk its way past a non-zero exit code.

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

The scanner works on its own too, with no assistant involved — see
[the CLI section](#the-scanner-on-its-own).

## The rules

Nine, plus the one that gets missed. Full text in
[SKILL.md](./skills/nomoretime/SKILL.md).

**A leaked key stays leaked after you move it.** The agent's instinct is to move
a hardcoded key into `.env` and report it fixed. The key is still valid, and if
it was ever committed it is still in git history. Rotate first, then move — and
never say "fixed" about a key you only relocated.

1. Never put a secret behind `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_`
2. Never write a credential into source
3. Never leave a write endpoint open
4. Never put a metered API behind an open endpoint
5. Never widen CORS to make a CORS error go away
6. Never leave database rules at `if true`
7. Never build SQL by interpolation
8. Never log a secret
9. Delete the debug endpoint you added

Plus a rule against crying wolf: Supabase anon keys, Firebase web config and
reCAPTCHA site keys are *meant* to be public, and an assistant that warns about
them teaches you to ignore the warnings that matter.

## What the scanner checks

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

## What this is not

A general-purpose security scanner. Those exist, they are good, and they will
hand you six hundred findings you will not read.

This one only knows about mistakes that are **specific to how AI-assisted code
gets built and shipped**, and it tries hard to stay quiet otherwise. If you run
it and the output is noise, the tool has failed, not you.

Once you outgrow it, run [gitleaks](https://github.com/gitleaks/gitleaks),
[semgrep](https://github.com/semgrep/semgrep), or `npm audit` alongside it.

## Design rules

The whole thing is built around not wasting your attention.

**A secret is never echoed back.** Findings quote the offending line with the
value redacted. A tool that prints your key into a CI log has leaked it a second
time, somewhere with a longer memory.

**Placeholders are not findings.** `sk-your-key-here`, `<YOUR_TOKEN>`,
`sk-xxxxxxxx` are skipped, along with lockfiles, `node_modules`, `dist`, and
every other generated directory. So are test fixtures and documentation, which
contain bad patterns on purpose.

**Public-by-design keys are left alone.** Supabase `service_role` keys look
identical to anon keys and are the opposite of safe — so the JWT's `role` claim
is what gets checked, not the variable name.

**Where a file runs decides how bad it is.** The same hardcoded key is
`critical` in browser code and `high` on a server. When the tool cannot tell
which side a file runs on, it declines to guess rather than inventing a
critical.

**Outbound credentials are not inbound checks.** `Authorization: Bearer ${key}`
on a `fetch` is your server *spending* a credential, not guarding an endpoint.
Reading that as "this route is authenticated" would wave through exactly the
wide-open AI proxies this exists to find.

## The scanner on its own

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
something was, and `2` when you gave it a bad argument.

In CI:

```yaml
- run: npx nomoretime --fail-on critical
```

As a pre-push hook:

```bash
echo 'npx nomoretime --fail-on critical' >> .husky/pre-push
```

Sometimes you really did mean it:

```js
const DEMO_KEY = "sk-not-a-real-key-just-for-the-docs"; // nomoretime-ignore
```

Programmatically:

```js
import { check } from 'nomoretime';

const { findings, counts } = check(process.cwd());
if (counts.critical > 0) process.exit(1);
```

Each finding is `{ ruleId, severity, file, line, snippet, message, why, fix }`.

## Portability

The skill's frontmatter uses only the six fields in the
[Agent Skills](https://agentskills.io) spec, so the same file loads in Claude
Code, Cursor, claude.ai, and the Skills API without edits. A test enforces this —
one Claude-Code-only field and packaging for claude.ai fails with a hard error.

## False positives

They are bugs, and they are the bugs that matter most here — one bad finding
costs more trust than five good ones earn. If this flags something correct,
[open an issue](https://github.com/lolpopa360/nomoretime/issues) with the
pattern that tripped it.

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

Editing `skills/nomoretime/SKILL.md`? Copy it to `.cursor/skills/nomoretime/`
too; a test checks the two stay identical.

## License

MIT
