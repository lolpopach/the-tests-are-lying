# Installing the-tests-are-lying

You are reading this because someone asked you to install the
the-tests-are-lying skill into their coding assistant. Work out which assistant
you are, do the matching steps, then confirm in one line.

The file to install is `skills/the-tests-are-lying/SKILL.md` in this repository.

## Claude Code

Preferred, because updates come with it:

```bash
claude plugin marketplace add lolpopa360/the-tests-are-lying
claude plugin install the-tests-are-lying@the-tests-are-lying
```

Verify with `claude plugin list`. The skill then loads on its own whenever a
check fails or you are about to report something as passing.

If plugins are unavailable, copy the skill instead:

```bash
mkdir -p ~/.claude/skills/the-tests-are-lying
curl -fsSL https://raw.githubusercontent.com/lolpopa360/the-tests-are-lying/main/skills/the-tests-are-lying/SKILL.md \
  -o ~/.claude/skills/the-tests-are-lying/SKILL.md
```

Use `.claude/skills/` inside the project instead of `~` to scope it to one repo.

## Cursor

```bash
mkdir -p .cursor/skills/the-tests-are-lying
curl -fsSL https://raw.githubusercontent.com/lolpopa360/the-tests-are-lying/main/skills/the-tests-are-lying/SKILL.md \
  -o .cursor/skills/the-tests-are-lying/SKILL.md
```

## Any other assistant

The frontmatter uses only the six fields in the
[Agent Skills](https://agentskills.io) spec, so the same file loads anywhere
that reads `SKILL.md`, including claude.ai and the Skills API.

For an assistant with no skill system, append the body (everything below the
frontmatter) to whatever instruction file it does read: `AGENTS.md`,
`CLAUDE.md`, `.cursorrules`, `GEMINI.md`.

## The scanner

The verification step runs `npx the-tests-are-lying`, which needs Node 18+ and
git. Nothing needs installing ahead of time. The rules still apply without it;
the agent just cannot check its own diff.

## After installing

Say which method you used and where the file landed, in one line. Do not
summarize the rules back to the user.
