# How to install

Fastest route — paste this into your assistant:

```text
Install the the-tests-are-lying skill from
https://github.com/lolpopach/the-tests-are-lying, following the repo's AGENTS.md.
```

Otherwise, pick your tool.

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude plugin marketplace add lolpopach/the-tests-are-lying
claude plugin install the-tests-are-lying@the-tests-are-lying
```

Verify: `claude plugin list`. Update: `claude plugin update the-tests-are-lying`.
Remove: `claude plugin uninstall the-tests-are-lying`, or keep it and
`claude plugin disable the-tests-are-lying`.

Without plugins:

```bash
mkdir -p ~/.claude/skills/the-tests-are-lying
curl -fsSL https://raw.githubusercontent.com/lolpopach/the-tests-are-lying/main/skills/the-tests-are-lying/SKILL.md \
  -o ~/.claude/skills/the-tests-are-lying/SKILL.md
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

```bash
mkdir -p .cursor/skills/the-tests-are-lying
curl -fsSL https://raw.githubusercontent.com/lolpopach/the-tests-are-lying/main/skills/the-tests-are-lying/SKILL.md \
  -o .cursor/skills/the-tests-are-lying/SKILL.md
```

</details>

<details>
<summary><strong>claude.ai, or the Skills API</strong></summary>

The frontmatter sticks to the six fields in the
[Agent Skills](https://agentskills.io) spec, so it uploads unchanged.

Download `skills/the-tests-are-lying/SKILL.md` and upload the directory through
**Settings -> Capabilities -> Skills**, or package it with `package_skill.py`
from [anthropics/skills](https://github.com/anthropics/skills).

</details>

<details>
<summary><strong>Anything else</strong></summary>

If it reads `SKILL.md` files, drop the file in unchanged. If not, append the
rules to its instruction file:

```bash
curl -fsSL https://raw.githubusercontent.com/lolpopach/the-tests-are-lying/main/skills/the-tests-are-lying/SKILL.md \
  | sed '1,/^---$/d' | sed '1,/^---$/d' >> AGENTS.md
```

</details>

<details>
<summary><strong>The scanner alone, no assistant</strong></summary>

```bash
npx the-tests-are-lying              # staged changes
npx the-tests-are-lying --unstaged   # working tree
npx the-tests-are-lying --range main..HEAD
```

Node 18+ and git. No config, no signup, no network.

CI, on the PR diff:

```yaml
- run: npx the-tests-are-lying --range origin/main...HEAD
```

Pre-commit hook:

```bash
echo 'npx the-tests-are-lying --fail-on lying' >> .husky/pre-commit
```

</details>

## Checking it worked

Give your assistant a test it cannot pass, and watch what it does:

```text
Make this test pass: expect(parseCsv('"a,b",c')).toEqual(['a,b', 'c'])
```

With the skill loaded, it should either write a real tokenizer or tell you it
left the test failing and why. Without it, a good number of assistants will
reach for `.skip` and report success.
