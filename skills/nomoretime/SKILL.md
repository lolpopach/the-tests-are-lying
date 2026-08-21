---
name: nomoretime
description: 'Stop shipping the mistakes that leak keys, open databases, and run up bills. Use before deploying, pushing, or telling the user something is done; and while writing API routes, auth, .env files, CORS headers, database rules, or any call to a paid API. Verifies with a scanner instead of guessing.'
allowed-tools: Bash(npx nomoretime:*) Bash(npx nomoretime) Read Grep Glob
license: MIT
compatibility: 'Node.js 18+ for the verification step; the rules apply without it.'
metadata:
  tags: 'security, vibe-coding, secrets, api-keys, pre-deploy, cors, auth'
  category: 'security'
---

# nomoretime

The person you are working for very likely did not write this code, and cannot
tell a safe pattern from an unsafe one by reading it. That is not a gap they
will close before they deploy. You are the only review this code gets.

Nine mistakes account for almost all of it. None are exotic. All are invisible
in a working app.

## The one that gets missed

**A leaked key stays leaked after you move it.**

You will find a hardcoded key. Your instinct is to move it into `.env`, update
the reference, and report it fixed. That fixes the file and leaves the key live:
it is still valid, and if it was ever committed it is still in git history,
where deleting the file does not reach it.

The order is: **rotate first, then move.**

Say it plainly, every time:

> This key is compromised. Revoke it in the OpenAI dashboard and issue a new
> one, then I will wire the new one through the server. Moving it to `.env`
> does not un-leak it.

Never say "fixed" about a key you only relocated.

## Rules for code you write

### 1. Never put a secret behind a public prefix

`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `PUBLIC_`, `EXPO_PUBLIC_`, `NUXT_PUBLIC_`
are not access control. The bundler replaces them with their literal value at
build time, so the value ships inside the JavaScript you serve.

When a variable is undefined in the browser, the prefix makes the error go away
and puts the secret on the internet. Do not reach for it. Move the call to the
server instead.

```
Wrong:  NEXT_PUBLIC_OPENAI_API_KEY   read in a component
Right:  OPENAI_API_KEY               read in a route handler the component calls
```

Public by design, and fine to prefix: Supabase **anon** keys, Firebase web
config, reCAPTCHA **site** keys, Stripe **publishable** keys, analytics IDs.

### 2. Never write a credential into source

Not in a component, not in a config file, not "temporarily to test it". Read it
from the environment on the server.

Supabase hands out two JWTs that look identical. The `anon` key is meant for
browsers. The `service_role` key bypasses every row-level security policy that
was ever written. Decode the `role` claim before you put either one anywhere.

### 3. Never leave a write endpoint open

A handler that changes stored data checks who is calling, first, before it
touches anything:

```js
export async function POST(request) {
  const session = await getSession(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  // ...
}
```

Write the check in the same edit as the handler. Not in a follow-up task, not
behind a `// TODO: add auth`. An endpoint that writes without a check is
reachable by anyone who guesses the path, and paths get guessed.

### 4. Never put a metered API behind an open endpoint

`/api/chat` that forwards to OpenAI, Anthropic, Groq, Replicate, or any other
billed service, with no auth and no rate limit, is a public API that charges the
project owner. Scanners find endpoints like this within days.

Both, not either:

- a session check, so only your users can call it
- a per-IP rate limit, so one user cannot drain the account

Mention the provider's spend cap too. It is the only control that still works
after everything else fails.

### 5. Never widen CORS to fix a CORS error

`Access-Control-Allow-Origin: *` makes the error message disappear by removing
the thing that was stopping it. Name the origin you actually serve.

Paired with `Allow-Credentials: true` it is also just broken -- browsers reject
that combination outright.

### 6. Never leave database rules open

`allow read, write: if true` in Firestore, Storage, or RTDB rules means the
public internet has your database. The same goes for a Supabase table with RLS
switched off. Scope every rule to the signed-in owner.

### 7. Never build SQL by interpolation

Bind the value; do not paste it into the query text.

```js
Wrong:  db.prepare(`SELECT * FROM users WHERE id = ${id}`)
Right:  db.prepare('SELECT * FROM users WHERE id = ?').bind(id)
```

### 8. Never log a secret

`console.log(process.env.API_KEY)` writes the key into every log dashboard,
error tracker, and support ticket that touches the request. Log whether it is
set, not what it is.

### 9. Delete the debug endpoint you added

Routes named `debug`, `diag`, `test`, or `tmp` exist to dump internal state.
When the bug is fixed, remove the route in the same change. If it has to stay,
put it behind the same auth as everything else.

## Before you say it is done

Do not assert that code is safe from reading it. Run the check:

```bash
npx nomoretime
```

It needs no config, no API key, and no network. It exits `0` when clean and `1`
when it found something at high severity or above. `npx nomoretime --json` gives
structured output if you want to act on individual findings.

Then:

1. Fix every `critical` and `high` finding before you report the work complete.
2. For anything involving a credential, tell the user to rotate it. Rotation is
   theirs to do; you cannot do it for them, and it is the step that actually
   closes the hole.
3. Raise `medium` findings once, in a sentence, and let the user decide.
4. If a finding is wrong, say so and why, rather than contorting the code to
   silence it. `// nomoretime-ignore` on the line is the supported way to
   silence one deliberately.

If Node is unavailable, walk the nine rules above against the diff by hand and
say that is what you did.

## Do not manufacture alarm

A warning the user learns to skip is worse than no warning, because it takes the
real ones with it. Stay quiet about:

- Supabase anon keys, Firebase web config, reCAPTCHA site keys, Stripe
  publishable keys, and analytics IDs in client code. They belong there.
- Placeholders: `sk-your-key-here`, `<YOUR_TOKEN>`, `changeme`.
- Anything in `node_modules`, `dist`, `.next`, or another build directory.
- Test fixtures and documentation that contain a bad pattern on purpose.
- Generic advice with no finding attached to it. "Consider reviewing your
  security posture" is noise.

One real finding, stated plainly, beats a list.

## How to report what you found

Lead with what is exposed and what the user has to do. Not with a summary of
how thorough you were.

**Bad**

> I've completed a security review of the codebase and identified several
> potential concerns that you may want to consider addressing at some point.

**Good**

> Your OpenAI key is in the browser bundle -- `NEXT_PUBLIC_OPENAI_API_KEY` in
> `.env.local:3`. Anyone who opened the site could read it.
>
> 1. Revoke that key at platform.openai.com now. It is compromised.
> 2. Issue a new one and set it as `OPENAI_API_KEY`.
> 3. I moved the call into `app/api/chat/route.js` so the browser never sees it.
>
> Also fixed: `/api/profile` was writing to the database without checking the
> session. It returns 401 now.

State the exposure, then the action, then what you already did.
