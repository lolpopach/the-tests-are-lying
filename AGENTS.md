# Installing nomoretime

You are reading this because someone asked you to install the nomoretime skill
into their coding assistant. Work out which assistant you are, do the matching
steps, then confirm in one line.

The skill file to install is `skills/nomoretime/SKILL.md` in this repository.

## Claude Code

Preferred, because updates come with it:

```bash
claude plugin marketplace add lolpopa360/nomoretime
claude plugin install nomoretime@nomoretime
```

Verify with `claude plugin list`. The skill then loads on its own when relevant,
and `/nomoretime` invokes it directly.

If plugins are unavailable, copy the skill instead:

```bash
mkdir -p ~/.claude/skills/nomoretime
curl -fsSL https://raw.githubusercontent.com/lolpopa360/nomoretime/main/skills/nomoretime/SKILL.md \
  -o ~/.claude/skills/nomoretime/SKILL.md
```

Use `.claude/skills/nomoretime/SKILL.md` inside the project instead of `~` to
scope it to one repository.

## Cursor

```bash
mkdir -p .cursor/skills/nomoretime
curl -fsSL https://raw.githubusercontent.com/lolpopa360/nomoretime/main/skills/nomoretime/SKILL.md \
  -o .cursor/skills/nomoretime/SKILL.md
```

## Any other assistant

Every assistant that reads `SKILL.md` files takes the same file unchanged. Its
frontmatter uses only the six fields in the [Agent Skills](https://agentskills.io)
spec, so it also uploads to claude.ai and the Skills API without edits.

For an assistant with no skill system, append the rules to whatever instruction
file it does read -- `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `GEMINI.md`. Copy
the body of `skills/nomoretime/SKILL.md` below the frontmatter.

## The scanner

The skill's verification step runs `npx nomoretime`, which needs Node 18+ and no
other setup. Nothing needs installing ahead of time; `npx` fetches it. The rules
still apply without it, the agent just cannot verify its own work.

## After installing

Say which method you used and where the file landed, in one line. Do not
summarize the rules back to the user.
