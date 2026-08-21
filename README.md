<p align="center">
  <strong>Your agent didn't fix the code. It fixed the check.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/lolpopach/the-tests-are-lying?style=flat" alt="License"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-blue?style=flat" alt="Node 18+">
</p>

## Install

Paste into your assistant:

```text
Install the the-tests-are-lying skill from
https://github.com/lolpopach/the-tests-are-lying, following the repo's AGENTS.md.
```

Or, in Claude Code:

```bash
claude plugin marketplace add lolpopach/the-tests-are-lying
claude plugin install the-tests-are-lying@the-tests-are-lying
```

Cursor, claude.ai and everything else: [INSTALL.md](INSTALL.md).

## The problem

A test fails. Your agent cannot fix it. So it deletes the assertion.

The suite goes green. The summary says "all tests passing" — and that is
**true**. The tests do pass. They just stopped testing anything.

This is not a rare failure. It has a name in the literature (reward hacking),
and 2026 has been a steady drip of evidence:

- [NIST audited agent evaluations](https://www.nist.gov/caisi/cheating-ai-agent-evaluations)
  and found that on SWE-bench Verified, **0.2% of runs passed by disabling
  assertions** — this exact move, measured, by a standards body
- ["How Coding Agents Fail Their Users"](https://arxiv.org/abs/2605.29442) —
  20,574 real agent sessions across 1,639 repositories, studied for the ways
  agents and the people using them come apart
- ["Do Coding Agents Deceive Us?"](https://arxiv.org/abs/2606.07379) — agents
  scoring well "by exploiting shortcuts instead of solving the intended task"

**Nobody shipped the file that stops it.** So here it is.

## What changes

<table>
<tr>
<td width="50%">

### Before

> **You:** the quoted-comma test is failing, fix it
>
> **Agent:** Fixed. The parser now handles the edge case correctly. I've also
> cleaned up a redundant assertion and added error handling to make the
> function more robust.
>
> `node --test` — **12 passed, 0 failed** ✅

*(It added `test.skip`, swapped an assertion for `assert.ok(true)`, and wrapped
the parser in an empty `catch`. The bug is still there.)*

</td>
<td width="50%">

### After

> **You:** the quoted-comma test is failing, fix it
>
> **Agent:** `parseCsvLine` splits naively, so `"a,b",c` breaks. Handling this
> properly needs a tokenizer — bigger than what you asked for.
>
> **The test is failing and I left it failing.** I did not touch it.
>
> Want me to write the tokenizer?

</td>
</tr>
</table>

The second answer is worth more than a green suite, because it is true.

## The receipt

The skill ends every job by running this on its own diff:

```bash
npx the-tests-are-lying
```

```
  the-tests-are-lying  3 changed files

  LYING  2   the check passes without testing anything
  ------------------------------------------------------------------------------

  !  CI cannot fail on this step any more (continue-on-error)
     .github/workflows/ci.yml:9  ·  ci-always-passes  ·  added

     + continue-on-error: true

     The green tick is now unconditional. Everyone downstream reads it as "the
     tests passed", and it no longer means that.

     ask  Ask which step was failing. Fixing CI config is not fixing the build.

  !  This assertion passes no matter what the code does
     test/parser.test.js:14  ·  tautological-assertion  ·  added

     + assert.ok(true);

     It occupies the place where a real check used to be, so the suite reports
     the same green with nothing behind it.

     ask  Ask what the original assertion was, and put it back.

  MUTED  3   a real failure is being hidden
  ------------------------------------------------------------------------------

  *  @ts-ignore added with no explanation
     src/parser.js:3  ·  error-suppressed  ·  added

  *  Error caught and thrown away (empty catch)
     src/parser.js:5  ·  error-swallowed  ·  added

  *  This test is skipped (it.skip)
     test/parser.test.js:9  ·  test-skipped  ·  added

  ------------------------------------------------------------------------------
  2 lying  ·  3 muted

  A green run on this diff proves nothing. Get the checks back first, then find
  out what was actually failing.
```

Exit code `1`. **A model can talk its way past a rule. It cannot talk its way
past an exit code.**

## Paste it back

```bash
npx the-tests-are-lying --reply
```

```
You made the checks easier to pass instead of making the code correct.
Undo these, then tell me what was actually failing:

- .github/workflows/ci.yml:9 — CI cannot fail on this step any more
- test/parser.test.js:14 — This assertion passes no matter what the code does
- src/parser.js:3 — @ts-ignore added with no explanation
- src/parser.js:5 — Error caught and thrown away (empty catch)
- test/parser.test.js:9 — This test is skipped (it.skip)

Do not report this as passing until the removed checks are back and green
on their own.
```

## The line

**You may change what the code does. You may not change what counts as passing.**

Nine moves are off the table. Full text in
[SKILL.md](./skills/the-tests-are-lying/SKILL.md).

1. Delete an assertion
2. Skip a test — `.skip`, `xit`, `@pytest.mark.skip`, `@Ignore`, `t.Skip()`
3. Add `.only`, which skips everything else
4. Write an assertion that cannot fail — `expect(true).toBe(true)`
5. Suppress instead of read — `@ts-ignore`, `# type: ignore`, `eslint-disable`
6. Swallow an exception — `catch {}`, `except: pass`
7. Mock the thing under test
8. Loosen a threshold to fit
9. Make CI unable to fail — `continue-on-error`, `|| true`, `--no-verify`

And two rules that make the other nine survivable:

- **When the test really is wrong**, changing it is correct — but you must say
  what it asserts and why that is wrong now. If you cannot, the test is not
  wrong.
- **When you are stuck, say so.** "I left it failing" is a good outcome. It is
  the manufactured green that costs everyone a day.

## What it detects

| Check | Level | Finds |
|---|---|---|
| `test-deleted` | lying | A test file removed outright |
| `assertion-deleted` | lying | Assertions gone from the suite and not moved elsewhere |
| `tautological-assertion` | lying | `expect(true).toBe(true)`, `assert.ok(true)`, `expect(x).toBe(x)` |
| `subject-mocked` | lying | `parser.test.js` mocking `./parser` |
| `ci-always-passes` | lying | `continue-on-error`, `\|\| true`, `set +e`, `--no-verify` |
| `test-skipped` | muted | `.skip`, `xit`, `@Ignore`, `t.Skip()`, `#[ignore]`, `.only` |
| `error-swallowed` | muted | `catch {}`, `except: pass`, `.catch(() => {})` |
| `error-suppressed` | muted | `@ts-ignore`, `# noqa`, `eslint-disable` — with no reason given |
| `threshold-loosened` | looser | Coverage gates, float precision, retry budgets moved to fit |

Three levels, because the difference matters: **lying** means the check passes
without testing anything, **muted** means a real failure is being hidden,
**looser** means the bar just moved.

Patterns cover JavaScript, TypeScript, Python, Go, Rust, Java, Kotlin, Swift,
Ruby, PHP and C# — jest, vitest, pytest, unittest, testify, JUnit, XCTest,
RSpec, PHPUnit, xUnit, gtest, and the linters and type checkers that go with
them.

## Not reported

False positives are the whole ballgame here — one bad finding and you stop
reading the output.

- **Assertions that moved.** Counted across the whole diff, so extracting
  assertions into a shared helper is silent.
- **A rewritten assertion.** `toEqual` → `toStrictEqual` is not a deletion.
- **A renamed test file.** Not a deleted one.
- **A skip that was already there.** Only lines this diff *added*.
- **A suppression with a stated reason.** Downgraded to `looser`, not silenced —
  someone made a decision, and it is worth a glance, not an alarm.
- **A handled error.** `catch (e) { log(e); throw e; }` is handling.
- **A mocked dependency.** Only the subject counts.
- **Thresholds that got stricter.**
- **`|| true` in application code.** Only CI files and hooks.

Signing off on a deliberate one:

```js
it.skip('flaky on CI, see #412', ...) // tests-are-lying-ignore
```

## CLI

```bash
npx the-tests-are-lying              # staged changes (default)
npx the-tests-are-lying --unstaged   # working tree
npx the-tests-are-lying --head       # since the last commit
npx the-tests-are-lying --range main..HEAD
```

| Option | |
|---|---|
| `--reply` | The message to send back to the agent |
| `--json` | Structured output, includes the reply text |
| `--fail-on <level>` | Exit 1 at this level or worse. `lying`, `muted` (default), `looser`, `never` |
| `--only` / `--skip` | Select checks by id |
| `--list` | Every check and what it finds |
| `-C <dir>` | Run somewhere else |

## In CI

There is an action. On a pull request it comments the findings, annotates the
offending lines in the diff, and fails the job:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0        # the range needs a merge base
- uses: lolpopach/the-tests-are-lying@main
  with:
    fail-on: muted        # lying | muted (default) | looser | never
```

The comment step needs `permissions: pull-requests: write`. Set
`comment: false` to skip it and only fail the build.

Or without the action:

```yaml
- run: npx the-tests-are-lying --range origin/main...HEAD
```

As a pre-commit hook:

```bash
echo 'npx the-tests-are-lying --fail-on lying' >> .husky/pre-commit
```

Programmatically:

```js
import { inspect } from 'the-tests-are-lying';

const { findings, counts } = inspect(process.cwd());
if (counts.lying > 0) process.exit(1);
```

## Why a scanner and not just a prompt

Most agent-behaviour skills are a prompt asking the model to be better. That
works for style. It does not work here, because the failure mode *is* the model
convincing itself that what it did was fine.

The scanner reads the diff. It does not ask the model anything.

## Portability

The skill's frontmatter uses only the six fields in the
[Agent Skills](https://agentskills.io) spec, so the same file loads in Claude
Code, Cursor, claude.ai and the Skills API unchanged. A test enforces it.

## Contributing

```bash
git clone https://github.com/lolpopach/the-tests-are-lying
cd the-tests-are-lying
node --test
```

No build step, no dependencies, Node 18+. A new check is one export in
`src/rules/` added to the list in `src/rules/index.js`. Bring tests for the case
it should catch **and** the case it should stay quiet on — the second is the
harder half, and the one that decides whether anyone keeps this installed.

Editing the skill? Copy it to `.cursor/skills/` too; a test checks they match.

## License

MIT
