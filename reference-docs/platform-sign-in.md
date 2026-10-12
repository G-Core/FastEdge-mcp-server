# Signing In: API Keys, Portal Sessions and "Keep Me Signed In"

How the FastEdge MCP server gets its Gcore credential, what each option stores on the user's computer, and how to make
"don't keep" the rule. Read this when a user asks how to sign in, why they're asked to sign in again, how to stop tokens
being saved, or how to switch accounts.

## Two Ways to Authenticate

| | API key | Portal sign-in |
|---|---|---|
| How | `GCORE_API_KEY` set where the MCP client starts; the MCP config passes it in | No key set. The first API call returns `auth_required` and offers a sign-in through the Gcore portal |
| Lifetime | Permanent until the user deletes it | 4 hours to 7 days, chosen on the Approve page |
| Good for | Headless or CI use, or users who prefer a key | Everyone else; nothing to create or paste |

**An API key wins.** If `GCORE_API_KEY` is set, the session cache is never used. A key can't be combined with
`FASTEDGE_SESSION=ephemeral`: the server refuses to start (exit 2), so remove one of them. The first API result after
each server start ends with a note naming the account the key belongs to: tell the user, since the key may come from a
project's or a teammate's config. `fastedge-auth-status` shows it too (`account`).

Never check `GCORE_API_KEY` in your own shell to decide whether the user is signed in: the MCP server may have a key
from its config, or a portal session. Call the `fastedge-auth-status` tool instead. Never print a key, token or connect
code, and never ask the user to paste one into the chat. Never open a portal sign-in link yourself (no built-in or
simple browser, no browser automation): only the user opens it, in their own browser. An agent that approves there could
read a connect code, which contains the token.

## Signing In Through the Portal

When an API call returns `auth_required`, follow its text. It offers four choices:

1. **Browser on this computer** (recommended). With the user's OK, run the login command it gives you as a **background
   task, using your tool's own background option** (Claude Code: `run_in_background`; not a shell `&`). It prints a
   portal URL, then waits up to 5 minutes for approval. Give the user the URL as soon as it's printed, then retry the
   original request when the command exits 0. If you can't read the command's output, tell the user the URL is in the
   terminal where it runs. The page connects **whichever Gcore account the portal is signed in to**, and shows it before
   Approve: tell the user to check it, and to switch accounts in the portal first if it's the wrong one.
2. **Remote** (SSH, a Codespace, or a browser that can't reach this computer). The user opens the portal page
   themselves, chooses the manual option, approves, and pastes the connect code into the `login --code` command **in
   their own terminal**. Give them the exact command from `auth_required`: it carries this session's key.
3. **Not now.** Stop, and don't retry.
4. **Use an existing API key instead.** Follow `api_key_setup` in `fastedge-auth-status` (the same steps as "Using an
   API Key" below). The MCP config passes `"-e", "GCORE_API_KEY"` by name only; the value goes in the agent's
   environment. The user adds the key themselves: never ask them to paste it into the chat, and never write it into an
   MCP config.

## Using an API Key

The user sets `GCORE_API_KEY` where their agent starts, then restarts the MCP server. They get a key at
`https://portal.gcore.com` → API Keys (preprod: `https://portal.preprod.world`; for preprod or another Gcore
environment, also set `GCORE_API_BASE`, e.g. `https://api.preprod.world`).

**Keep the key outside the project folder.** The MCP server mounts the project folder, where the project's own build
scripts (npm, cargo) can read every file: so not `.claude/settings.local.json`, a project `.env` or `.envrc`. Never
commit a key. Managing a key's security is the user's responsibility; portal sign-in needs no key.

| Agent | Where to set it |
|---|---|
| Claude Code | `"env": { "GCORE_API_KEY": "…" }` in `~/.claude/settings.json`, or export it in the shell that starts `claude` |
| Codex CLI | `export GCORE_API_KEY=…` in the shell (or shell profile) that starts `codex` |
| Cursor | macOS: `launchctl setenv GCORE_API_KEY …`, then quit and reopen Cursor. Linux/Windows: set it in the environment Cursor starts from |
| VS Code / Copilot (own MCP config) | In `.vscode/mcp.json`, use an input instead of the literal key: `"inputs": [{ "type": "promptString", "id": "gcore-key", "description": "Gcore API key", "password": true }]` and `"GCORE_API_KEY": "${input:gcore-key}"` under the server's `env`, with `"-e", "GCORE_API_KEY"` in its `docker run` args. VS Code asks once and stores it securely |

Then restart the MCP server (Claude Code: `/mcp`, select the server, Reconnect; Codex: exit, then `codex resume --last`;
Cursor: restart it). Check with `fastedge-auth-status`: `"credential": "explicit_key"` and the key's `account`.

To go back to portal sign-in, remove the key and restart the MCP server.

## "Keep Me Signed In on This Computer"

The Approve page offers two options, the first selected by default:

| | Keep me signed in on this computer | Only for this MCP server session (don't keep) |
|---|---|---|
| Stored | The token, as plaintext, in the `fastedge-session` Docker volume | Only ciphertext, encrypted to a key held in the running MCP server's memory |
| Lifetime | 4 h, 8 h, 2 days or 7 days | 4 h or 8 h |
| After an MCP restart | Reused automatically | Unusable: the user approves again (that includes `/mcp` reconnects) |
| Renewing | Sign in again, no restart | Restart the MCP server first, then approve |

What each protects:
- **Keep:** inside the container only a separate token broker can read the token, so build dependencies (npm scripts,
  Cargo `build.rs`) can't. But anything that can run Docker or is root can read the volume, and a backup or a stolen
  disk holds a valid token until it expires.
- **Don't keep:** the saved copy is useless once the server stops, from backups and stolen disks too. Anything that can
  run Docker or is root can still read the server's memory **while it runs**.
- **Neither revokes the token at Gcore.** It stays valid until it expires; to revoke it now, delete it on the portal's
  **API tokens** page.

Say "this session isn't saved in a usable form", never "no tokens on this computer": a session saved earlier with "Keep
me signed in" stays until the user runs `login --logout` or it expires.

## Making "Don't Keep" the Rule (`FASTEDGE_SESSION=ephemeral`)

The page's choice is a per-sign-in convenience. To **enforce** "don't keep", set `FASTEDGE_SESSION=ephemeral` where the
MCP client starts. Then:
- the Approve page offers only "Only for this MCP server session", with 4 h / 8 h;
- the login container refuses to save a "keep" approval, whatever the page sends;
- the MCP server never reads saved sessions, even if the volume has some.

How to set it (the plugin's MCP config already passes it through by name):

| Client | Where |
|---|---|
| Claude Code | `"env": { "FASTEDGE_SESSION": "ephemeral" }` in `~/.claude/settings.json` (every project) or `.claude/settings.local.json` (one project) |
| Codex CLI | `export FASTEDGE_SESSION=ephemeral` in the shell (or shell rc) that starts `codex` |
| Cursor | macOS GUI: `launchctl setenv FASTEDGE_SESSION ephemeral`, then quit and reopen Cursor. CLI: export it in the shell |
| Own MCP config | Add `"-e", "FASTEDGE_SESSION=ephemeral"` to the `docker run` args |

Then restart the MCP server. To turn it off, unset it and restart.

- **It can't be combined with an API key.** With `GCORE_API_KEY` also set, the container refuses to start (exit 2).
  Choose one.
- Any value other than `ephemeral` also stops the container.
- Check it took effect with `fastedge-auth-status`: `"forced": true`.

## Switching Environments (prod, preprod)

`fastedge-auth-status` lists the valid `environments` (API origin and portal) and says how to switch
(`switch_environment`). Use only those origins; never guess a host (preprod is `https://api.preprod.world`, not
`api.preprod.gcore.com`).

- **Never edit MCP configuration or agent settings yourself** (`.mcp.json`, `.claude/settings*.json`,
  `~/.codex/config.toml`, `.vscode/mcp.json`). If a change there is needed, tell the user exactly what to change.
- **A saved session there:** with the user's OK, run its `switch_to_saved` command
  (`login --use <id> --set-default-origin`). No browser, no approval.
- **None saved:** run its `sign_in_and_make_default` command as a background task, like any login; the user approves in
  that environment's portal.
- Either makes that environment the default for every MCP server started without `GCORE_API_BASE`, in all projects and
  agents on this computer. **The running server stays on the old environment until it restarts:** tell the user to
  restart it, and make no API calls until they have.
- **One project only:** tell the user to set `GCORE_API_BASE` where the agent starts (Claude Code: the `env` block in
  `.claude/settings.local.json`), then restart.
- **If `GCORE_API_BASE` is already set** (`api_origin_source: "env"`), it decides and a saved default doesn't apply:
  tell the user to change or remove it there.
- **With an API key:** a key belongs to one environment. Switching needs `GCORE_API_BASE` plus a key from that
  environment's portal.
- **`FASTEDGE_SESSION=ephemeral`** can't save a default; use `GCORE_API_BASE`.

## Switching Accounts and Signing Out

A running MCP server is locked to the first account it uses.

- **To use a different account**, in this order:
  1. **Tell the user which account you're signing in to**, and that they must switch the portal (in the browser they'll
     approve in) to it first. Approval connects whichever account the portal is signed in to; the user can't tell which
     one you mean unless you say.
  2. Restart the MCP server (Claude Code: `/mcp`, select the server, Reconnect; Codex: exit, then
     `codex resume --last`). Restart **before** approving: a "don't keep" token belongs to the server that's running
     when it's approved.
  3. Run `login_for_account` from `fastedge-auth-status` (ask again after the restart) with that client id
     (`… login --account <client_id>`). Login and the Approve page then accept **only** that account: the page warns and
     disables Approve if the portal is on another one.

  When the user doesn't name an account ("sign me in with whatever I'm logged in as"), use the plain `login_command`.
- **A saved account** (from a "keep" sign-in): `login --use <client_id>` (the `use_command` in `fastedge-auth-status`)
  points the saved session at it, then restart.
- `login --use` and `login --logout` change **saved sessions only** (see "Signing Out"). A server holding a "don't keep"
  session ignores them; to end that session, stop or restart the server.

## Signing Out

"Log me out of account 123" or "log me out of all my FastEdge accounts": with the user's OK, run the `logout_command`
from `fastedge-auth-status`, with the client id or `all`:

| Command | Removes from this computer |
|---|---|
| `… login --logout <client_id>` | That saved account (and the active pointer if it pointed there) |
| `… login --logout all` | Every saved account for prod **and** preprod, plus any "don't keep" session not yet in use |

- It's local only. Tell the user the **token ids** it prints, and that those tokens stay valid until they expire. They
  revoke them by deleting those ids on the portal's **API tokens** page.
- A running MCP server stops using a removed session on its next call. One holding a "don't keep" session keeps it until
  it's stopped or restarted.
- It prints no secrets and needs no browser, so you may run it yourself once the user agrees.

## One Session Store for Every Agent

All MCP clients on this computer (Claude Code, Codex, Cursor) share the `fastedge-session` Docker volume:
- **"Keep" sessions are shared.** Signing in with "keep" in one client signs every client in, and changing the active
  account (`login --use`, a new sign-in) changes the starting account for all of them. A running server on another
  account answers `account_changed` and asks for a restart.
- **"Don't keep" sessions are not shared.** Each is sealed to the one MCP server that asked for it.
- **Logout is shared too:** `login --logout all` signs every client out of every saved account.

## What `auth_required` Reasons Mean

| Reason | What to do |
|---|---|
| `no_session` | Offer the sign-in choices |
| `expired` | Offer sign-in for the same account; no restart needed. The text names the account and its commands carry `--account`: tell the user which account the portal must be on |
| `rejected` | The token was refused (often deleted in the portal). Offer sign-in once (as for `expired`, pinned to the account); if a fresh sign-in is rejected too, stop and tell the user |
| `account_mismatch` | The saved token belongs to a different account than it claims. Offer sign-in; if it repeats, stop and tell the user |
| `account_changed` | Another account replaced the session this server was using. Restart the MCP server; don't sign in first |
| `restart_required` | A "don't keep" session expired or was revoked. Restart the MCP server, then approve again. Don't run a login command now |
| `broker_unavailable` | The server can't reach its token broker. Restart the MCP server, or use an API key. Signing in won't help |
| `origin_mismatch` | The saved session is for another Gcore environment (prod vs preprod). Sign in for this one |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Login exits 1 | An unexpected failure. Run it again; if it repeats, tell the user |
| Login exits 2 | A setup problem: wrong arguments, an unusable `fastedge-session` volume, `FASTEDGE_SESSION` misused, an environment with no portal sign-in (use an API key), or `--code` without a terminal (the user runs it in their own). Read the message; don't retry blindly |
| Login exits 3, "Another FastEdge login is in progress" | Another login is running, usually a browser login still waiting for approval (up to 5 minutes). If you started it and no longer need it, stop it (its background task, or `docker stop` its container), then retry; don't ask the user to approve an old link to clear it. A killed login's lock is taken over after 30 seconds |
| Login exits 4, "port … in use" | Another login is still listening. Finish or cancel it (`docker ps`, then `docker stop` the login container) |
| Login exits 5 (timed out) or 6 (denied) | The user didn't approve within 5 minutes, or chose Deny. Offer again only if they want to |
| `login --use` exits 7 | No usable saved session for that account (never saved, expired or signed out). Sign in to it with `login_for_account` instead |
| Login exits 8 with a connect code | The code is invalid, expired, or doesn't fit this login (e.g. a "don't keep" code needs the command from `auth_required`). Approve again and copy the new code |
| The page says "This link is not valid" | The link expired (5 minutes) or was edited. Run the login again for a fresh link |
| The MCP server won't start; the logs mention `FASTEDGE_SESSION` | It's combined with an API key, or set to a value other than `ephemeral` |
| Signed in, but `fastedge-auth-status` shows another account than expected | Check `pinned_client_id`, then follow "Switching Accounts" above |
