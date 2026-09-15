# Trivia Night

A self-hosted trivia game night site. An admin logs in, builds a game with
any number of questions (multiple-choice or open text), and gets a
4-character code. Players open the site, enter the code and a name, and
play through the questions one at a time on a shared timer.

No framework, no build step, no database server to install — just Node.js
and a small JSON file on disk.

## Running it locally

Requires Node.js 18 or later.

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

The first time you click "Host login" you'll be asked to set a host
password — that's the only account in the system. Anyone with the password
can create, view, or delete games.

## How it's built

```
server.js          Express app + all API routes
lib/db.js           Tiny JSON-file "database" with a write queue so
                     concurrent requests (e.g. several players joining
                     at once) can't corrupt the file
lib/auth.js          Password hashing + in-memory host-login sessions
lib/game-utils.js    Game codes, scoring, and stripping correct answers
                     out of what's sent to players
public/index.html    The single page
public/styles.css    All visual styling
public/app.js        The whole frontend: a small hand-rolled state
                     machine that renders each screen and talks to the
                     API with fetch() — no React/Vue/build tooling
data/db.json         Created automatically on first run; holds the
                     host password (hashed), every game, and every
                     player's score. Back this file up if you care
                     about keeping past games.
```

**Scoring happens on the server.** A player's browser only ever receives
question prompts and (for multiple choice) the list of options — never
which one is correct or what the accepted text answers are. When a
question's timer runs out, the browser sends whatever the player had
selected/typed to the server, which checks it against the real answer and
returns the updated score. This means opening the browser dev tools can't
reveal answers or let someone fake a perfect score.

**The timer is enforced client-side.** Each player's browser counts down
locally and calls the server when time's up. That's simple and works well
for a casual game night, but a technically motivated player could in
theory delay that call. If you ever need this to be tamper-proof for a
competitive/paid setting, the fix is to also track elapsed time
server-side and reject late answers — ask if you want that added.

## Deploying it somewhere real

This is a normal Node.js + Express app, so it runs on anything that runs
Node: a small VPS, Render, Railway, Fly.io, etc.

General steps:
1. Push this folder to a git repo (the `.gitignore` already excludes
   `node_modules` and the local `data/db.json`).
2. On the host: `npm install` then `npm start` (or let the platform run
   `npm start` for you — most do this automatically).
3. Set the `PORT` environment variable if your host requires a specific
   port (it defaults to 3000).
4. Make sure `data/` is on a **persistent disk** — on platforms with an
   ephemeral filesystem (some free tiers), the games and host password
   will be wiped on every redeploy or restart. If that matters to you,
   look for a host with a persistent volume, or ask about swapping in a
   real database (e.g. Postgres/SQLite) instead of the JSON file.
5. Put it behind HTTPS. Most platforms (Render, Railway, Fly.io, etc.)
   handle this for you automatically; on a bare VPS, put it behind Nginx
   or Caddy with a free Let's Encrypt certificate.

## Known limitations, on purpose

These are reasonable trade-offs for a game-night tool, not oversights —
flag them if any matter for how you plan to use this:

- **One host password for everyone who hosts.** There's no concept of
  separate admin accounts. Fine for one person or a small trusted group
  running games; not meant for a public multi-tenant product.
- **Login sessions reset on server restart** (they're kept in memory, not
  in the database). Hosts just log in again — games and scores aren't
  affected.
- **A player who refreshes mid-game loses their place** — there's no
  "resume" flow. They'd need to rejoin under a different name.
- **The JSON file is a fine database up to hundreds of games/players**,
  not built for heavy concurrent traffic. If you outgrow it, the `lib/db.js`
  interface (`readDb` / `mutate`) is small and deliberately isolated so
  swapping in a real database only touches that one file.
