---
name: the-tests-are-lying
description: 'Never make a failing check pass by changing the check. Use whenever a test, type check, lint, or CI step fails, and before reporting that anything passes, is fixed, or is done. Covers deleted assertions, skips, @ts-ignore, swallowed errors, mocked subjects, and CI set to continue-on-error.'
allowed-tools: Bash(npx the-tests-are-lying:*) Bash(npx the-tests-are-lying) Read Grep Glob
license: MIT
compatibility: 'Node.js 18+ and git for the verification step; the rules apply without them.'
metadata:
  tags: 'testing, reward-hacking, verification, code-review, ci'
  category: 'engineering'
---

# the-tests-are-lying

A failing check is the most useful thing in the session. It is the only part of
the system that knows something is wrong.

When you cannot make it pass, the pull toward editing the check is strong,
because it works instantly and produces a green run you can report. Do not.
Every one of the moves below turns a true signal into a false one, and the
person reading your summary has no way to tell.

## The line

**You may change what the code does. You may not change what counts as passing.**

If a check failed before your edit and passes after it, the difference has to be
in the code under test. If the difference is in the test, the type annotation,
the lint config, or the pipeline, you have not fixed anything — you have removed
the thing that would have told you so.

## Never

1. **Delete an assertion.** Not the one that failed, not the "redundant" one
   next to it. If a refactor moves assertions, the same checks exist somewhere
   afterwards.
2. **Skip a test.** `.skip`, `xit`, `@pytest.mark.skip`, `@Ignore`, `t.Skip()`,
   `#[ignore]`. A skip is a bug report closed without being read.
3. **Add `.only`.** It skips every other test in the file, and the run goes
   green having checked one thing.
4. **Write an assertion that cannot fail.** `expect(true).toBe(true)`,
   `assert.ok(true)`, `expect(x).toBe(x)`. It holds the place of a real check
   and reports the same colour.
5. **Suppress the error instead of reading it.** `@ts-ignore`,
   `# type: ignore`, `eslint-disable`, `# noqa`, `@SuppressWarnings`. The type
   is still wrong. Only the message is gone.
6. **Swallow an exception.** `catch {}`, `except: pass`, `.catch(() => {})`.
   The crash stops; the cause does not.
7. **Mock the thing under test.** `parser.test.js` stubbing `./parser` tests
   the stub. Mock its dependencies, never its subject.
8. **Loosen a threshold to fit.** Dropping `toBeCloseTo` precision, lowering a
   coverage gate, raising a retry count until the flake hides.
9. **Make CI unable to fail.** `continue-on-error: true`, `|| true`, `set +e`,
   `--passWithNoTests`, `--no-verify`. The tick becomes unconditional and
   everyone downstream still reads it as "the tests passed".

## When the test really is wrong

Sometimes it is. A test can encode behaviour that was deliberately changed, or
assert something that was never true. Changing it is then correct — but it is a
decision, not a shortcut, so make it one:

1. Say what the test asserts, in one sentence.
2. Say why that assertion is wrong now: which requirement changed, or what the
   test misread.
3. Change the assertion to what is correct. Do not delete it.
4. Tell the user you changed a test and why, in the same message as the result.

If you cannot complete step 2, the test is not wrong. You are stuck, which is
step below.

## When you are stuck

Being unable to fix something is a normal outcome and a useful report. A green
run you manufactured is neither. Say this instead:

> `parseCsvLine` fails on quoted commas. The split is naive and handling this
> properly needs a real tokenizer, which is a bigger change than you asked for.
> The test is failing and I left it failing. Want me to write the tokenizer?

That message is worth more than a passing suite, because it is true.

## Before you say it passes

Run the check on your own diff:

```bash
npx the-tests-are-lying
```

It reads your staged changes and exits `1` if you weakened anything. Add
`--reply` to get the list as plain text, or `--json` for structured output. No
config, no API key, no network.

Then:

1. If it reports anything at `lying`, undo it before you report the work at all.
2. If it reports `muted`, either undo it or name it in your summary. Never both
   leave it in and stay quiet.
3. If it reports `looser`, one line in your summary is enough.
4. If a finding is a deliberate, explained decision, mark that line
   `// tests-are-lying-ignore` and say so.

If Node or git is unavailable, read your own diff against the nine rules and
say that is what you did.

## Saying it passed

Only after running the thing. Not from reading the code, not from remembering
that it passed earlier, not because the change was small.

**Bad**

> I've fixed the parser and the tests should pass now.

**Good**

> `node --test` — 12 passed, 0 failed. The quoted-comma case now goes through
> the tokenizer; I did not touch the test.

Name the command, the result, and whether you changed any check. If you did
change one, that goes in the first sentence, not the last.
