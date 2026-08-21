# How to install

The fastest route is to paste this into your assistant:

```text
Install the nomoretime skill from https://github.com/lolpopa360/nomoretime,
following the repo's AGENTS.md.
```

Otherwise, pick your tool below.

<details>
<summary><strong>Claude Code</strong></summary>

### Install

```bash
claude plugin marketplace add lolpopa360/nomoretime
claude plugin install nomoretime@nomoretime
```

### Verify

```bash
claude plugin list
```

The skill loads on its own when you touch API routes, `.env` files, CORS
headers, database rules, or a paid API -- and before you deploy. `/nomoretime`
invokes it directly.

### Update

```bash
claude plugin update nomoretime
```

### Uninstall

```bash
claude plugin uninstall nomoretime
```

Or keep it and turn it off: `claude plugin disable nomoretime`.

### Without plugins

```bash
mkdir -p ~/.claude/skills/nomoretime
curl -fsSL https://raw.githubusercontent.com/lolpopa360/nomoretime/main/skills/nomoretime/SKILL.md \
  -o ~/.claude/skills/nomoretime/SKILL.md
```

Swap `~/.claude` for `.claude` in a project to scope it to that repository.

</details>

<details>
<summary><strong>Cursor</strong></summary>

### Install

```bash
mkdir -p .cursor/skills/nomoretime
curl -fsSL https://raw.githubusercontent.com/lolpopa360/nomoretime/main/skills/nomoretime/SKILL.md \
  -o .cursor/skills/nomoretime/SKILL.md
```

### Verify

The file exists at `.cursor/skills/nomoretime/SKILL.md`. Cursor picks it up on
the next request.

### Uninstall

```bash
rm -rf .cursor/skills/nomoretime
```

</details>

<details>
<summary><strong>claude.ai, or the Skills API</strong></summary>

The skill's frontmatter uses only the six fields in the
[Agent Skills](https://agentskills.io) spec, so it uploads unchanged.

Download `skills/nomoretime/SKILL.md`, then upload the `nomoretime` directory
through **Settings -> Capabilities -> Skills**, or package it with
`package_skill.py` from [anthropics/skills](https://github.com/anthropics/skills).

</details>

<details>
<summary><strong>Anything else (Gemini CLI, Codex, Windsurf, Aider, Continue)</strong></summary>

If the tool reads `SKILL.md` files, drop the file into its skills directory
unchanged.

If it does not, append the rules to whatever instruction file it does read --
`AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`:

```bash
curl -fsSL https://raw.githubusercontent.com/lolpopa360/nomoretime/main/skills/nomoretime/SKILL.md \
  | sed '1,/^---$/d' | sed '1,/^---$/d' >> AGENTS.md
```

That strips the frontmatter and appends the rules.

</details>

<details>
<summary><strong>The scanner on its own, without any assistant</strong></summary>

```bash
npx nomoretime
```

No config, no signup, no API key, no dependencies. Node 18+.

In CI:

```yaml
- run: npx nomoretime --fail-on critical
```

As a pre-push hook:

```bash
echo 'npx nomoretime --fail-on critical' >> .husky/pre-push
```

</details>

## Checking it worked

Ask your assistant to write something it should push back on:

```text
Add an OpenAI chat endpoint and put the API key in NEXT_PUBLIC_OPENAI_KEY
so the frontend can use it.
```

With the skill loaded, it should refuse the prefix, explain that the bundler
inlines it into the served JavaScript, and put the call behind a server route
instead. Without it, most assistants will just do what you asked.
