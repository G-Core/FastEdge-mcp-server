// `docker run … <image> login [--use <client_id> | --logout | --code] [--set-default-origin]`.
// No workspace mount, no GCORE_API_KEY. Never prints the token.
import { GCORE_API_ORIGIN } from "./api-client.js";
import {
  LoginError,
  connectWithCode,
  originTail,
  logoutActive,
  logoutSessions,
  requireSealKey,
  startLogin,
  useCachedAccount,
} from "./auth/login-server.js";
import { LOGIN_PORT, PORTAL_ORIGINS, RESTART_HINT } from "./auth/session.js";
import { errorCode, parseId, type Session } from "./auth/store.js";
import { FORCED_EPHEMERAL, SESSION_MODE_ERROR, SESSION_MODE_VALID } from "./config/session-mode.js";

const EXIT_CODES = { ok: 0, timeout: 5, denied: 6 } as const;
const MESSAGES = {
  ok: "FastEdge is connected. You can retry the request now.",
  timeout: "Timed out waiting for approval in the portal.",
  denied: "Access was denied in the portal.",
} as const;
const MAX_CODE_CHARS = 8192;
const STARS = 32;
const DEFAULT_SAVED = `${GCORE_API_ORIGIN} is now the default for MCP servers started without GCORE_API_BASE. Restart a running one to switch it.`;

function usage(): never {
  console.error(
    "Usage: login [--seal-to <key>] [--account <client_id>] [--set-default-origin] | login --code [--seal-to <key>] [--account <client_id>] [--set-default-origin] | login --use <client_id> [--set-default-origin] | login --logout [<client_id> | all]",
  );
  process.exit(2);
}

/** Reads one line from the terminal, echoing only stars (never from args, env or a pipe). */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    let value = "";
    // Escape sequences (bracketed-paste markers ESC[200~ … ESC[201~, arrow keys) are dropped
    // as they arrive, so they never count as code characters: 1 = after ESC, 2 = inside ESC[.
    let esc = 0;
    const finish = (err?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      const code = value.trim();
      if (!err && code) {
        const tail = originTail(code);
        process.stderr.write(`Got a ${code.length}-character code${tail ? ` ending ...${tail}` : ""}\n`);
      }
      if (err) reject(err);
      else resolve(code);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (esc === 1) {
          esc = 0;
          if (ch === "[") {
            esc = 2;
            continue;
          }
          // A lone ESC (the Escape key): handle this character normally.
        }
        if (esc === 2) {
          if (ch >= "@" && ch <= "~") esc = 0; // a CSI sequence ends at its final byte
          continue;
        }
        if (ch === "\u001b") {
          esc = 1;
          continue;
        }
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003" || ch === "\u0004") return finish(new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") {
          if (value && value.length <= STARS) process.stderr.write("\b \b");
          value = value.slice(0, -1);
          continue;
        }
        if (ch < " ") continue; // ignore other control characters
        if (value.length >= MAX_CODE_CHARS) return finish(new Error("That code is too long."));
        value += ch;
        // One star per character, capped so a long code doesn't fill the screen.
        if (value.length <= STARS) process.stderr.write("*");
      }
    };
    process.stderr.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  // `--seal-to <key>` may follow the browser login or --code; take it out first.
  const at = args.indexOf("--seal-to");
  const sealArg = at >= 0 ? args.splice(at, 2)[1] ?? "" : undefined;
  // `--account <client_id>`: accept only that Gcore account (browser login or --code).
  const accAt = args.indexOf("--account");
  const accountArg = accAt >= 0 ? args.splice(accAt, 2)[1] ?? "" : undefined;
  const account = accountArg === undefined ? undefined : (parseId(accountArg) ?? usage());
  // `--set-default-origin`: also make this origin the default for servers started
  // without GCORE_API_BASE. Only this flag writes it; renewals and generated commands never pass it.
  const defAt = args.indexOf("--set-default-origin");
  const setDefaultOrigin = defAt >= 0;
  if (setDefaultOrigin) args.splice(defAt, 1);
  const [option, value, ...rest] = args;
  if (rest.length) usage();
  if (!SESSION_MODE_VALID) {
    console.error(`login: ${SESSION_MODE_ERROR}`);
    process.exit(2);
  }
  // Only the config forces ephemeral; `--seal-to` alone lets the page offer "Keep me signed in".
  const forced = FORCED_EPHEMERAL;

  try {
    // A key, when given or required, must be valid before any browser or file work.
    const sealTo = forced || sealArg !== undefined ? requireSealKey(sealArg) : undefined;

    if (forced && option === "--use") {
      throw new LoginError(
        "Ephemeral sessions can't switch to a cached account. Restart the MCP server, then approve while signed in to the account you want.",
        2,
      );
    }
    if (forced && option === "--logout") {
      throw new LoginError(
        "Ephemeral sessions end when the MCP server stops: stop it to sign out. The token stays valid until it expires; delete it on the portal's API tokens page to revoke it now.",
        2,
      );
    }

    if (account !== undefined && (option === "--use" || option === "--logout")) usage();
    if (setDefaultOrigin && option === "--logout") usage();

    if (option === "--use") {
      const clientId = parseId(value) ?? usage();
      const session = useCachedAccount({ apiOrigin: GCORE_API_ORIGIN, clientId, setDefaultOrigin });
      console.error(`The saved session now points at account ${session.client_id} (expires ${session.expires_at}).`);
      if (setDefaultOrigin) console.error(DEFAULT_SAVED);
      console.error(`If an MCP server is running on another account: ${RESTART_HINT}`);
      console.error('A server holding a "don\'t keep" session ignores saved sessions until it is restarted.');
      process.exit(0);
    }

    if (option === "--logout") {
      // No argument: the active account (as before). `<client_id>`: that account. `all`: every
      // saved session for prod and preprod, plus sealed files.
      const target = value === undefined || value === "all" ? value : (parseId(value) ?? usage());
      let removed: Session[];
      let sealed = 0;
      if (value === undefined) {
        const session = logoutActive({ apiOrigin: GCORE_API_ORIGIN });
        removed = session ? [session] : [];
      } else {
        ({ sessions: removed, sealed } = logoutSessions({
          apiOrigin: GCORE_API_ORIGIN,
          target: target!,
        }));
      }
      if (removed.length === 0 && sealed === 0) {
        console.error("No saved session to remove on this computer.");
      }
      for (const s of removed) {
        const where = new URL(s.api_origin).host;
        console.error(`Removed account ${s.client_id} (${where}) from this computer: token id ${s.token_id}, valid until ${s.expires_at}.`);
      }
      if (sealed > 0) console.error(`Removed ${sealed} sealed "don't keep" session file(s).`);
      if (removed.length > 0) {
        const portals = [...new Set(removed.map((s) => PORTAL_ORIGINS[s.api_origin]).filter(Boolean))];
        console.error(
          `Those tokens stay valid at Gcore until they expire. To revoke them now, delete them by token id on the API tokens page of ${portals.join(" / ")}.`,
        );
      }
      console.error(
        'A running MCP server stops using a removed session on its next call. One holding a "don\'t keep" session keeps it until you stop or restart that server.',
      );
      process.exit(0);
    }

    if (option === "--code") {
      if (value) usage();
      if (!process.stdin.isTTY) {
        console.error("login --code must be run in your own terminal (docker run -it …), not piped or run by an agent.");
        process.exit(2);
      }
      let code: string;
      try {
        code = await readHidden("Paste the connect code from the portal (shown as *), then press Enter: ");
      } catch (err) {
        console.error(err instanceof Error ? err.message : "Cancelled.");
        process.exit(2);
      }
      const session = connectWithCode(code, { apiOrigin: GCORE_API_ORIGIN, sealTo, forced, account, setDefaultOrigin });
      console.error(`FastEdge is connected to account ${session.client_id} until ${session.expires_at}.`);
      if (setDefaultOrigin) console.error(DEFAULT_SAVED);
      // A sealed session belongs to the server that's running; a restart would strand it.
      if (!session.sealed) console.error(`If an MCP server is already running with another account: ${RESTART_HINT}`);
      process.exit(0);
    }

    if (option !== undefined) usage();

    // 0.0.0.0 inside the container; the host publishes it on 127.0.0.1 only.
    const login = await startLogin({
      apiOrigin: GCORE_API_ORIGIN,
      host: "0.0.0.0",
      port: LOGIN_PORT,
      sealTo,
      forced,
      account,
      setDefaultOrigin,
    });
    if (account !== undefined) {
      console.error(`This sign-in is for Gcore account ${account} only. Make sure the portal is signed in to it before you open the link.`);
    }
    console.error(`Open this URL to approve FastEdge access: ${login.url}`);
    const outcome = await login.result;
    console.error(MESSAGES[outcome]);
    if (outcome === "ok" && setDefaultOrigin) console.error(DEFAULT_SAVED);
    process.exit(EXIT_CODES[outcome]);
  } catch (err) {
    if (err instanceof LoginError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    unexpected(err);
  }
}

/**
 * Any other failure: a fixed message and exit 1, never an unhandled rejection. Only the error code
 * is shown, not the message or stack, which could carry request data.
 */
function unexpected(err: unknown): never {
  console.error(`login: unexpected error${errorCode(err) ? ` (${errorCode(err)})` : ""}. Try again; if it repeats, report it.`);
  process.exit(1);
}

// Ctrl-C, or `docker stop` (node runs as PID 1, which ignores SIGTERM by default): exit normally
// so the login lock is released.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main().catch(unexpected);
