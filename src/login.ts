// `docker run … <image> login [--use <client_id> | --logout | --code]` (PROTOCOL.md §3).
// No workspace mount, no GCORE_API_KEY (S16). Never prints the token (S3).
import { GCORE_API_ORIGIN } from "./api-client.js";
import {
  LoginError,
  connectWithCode,
  logoutActive,
  logoutSessions,
  requireSealKey,
  startLogin,
  useCachedAccount,
} from "./auth/login-server.js";
import { LOGIN_PORT, PORTAL_ORIGINS, RESTART_HINT } from "./auth/session.js";
import { parseId, type Session } from "./auth/store.js";

const EXIT_CODES = { ok: 0, timeout: 5, denied: 6 } as const;
const MESSAGES = {
  ok: "FastEdge is connected. You can retry the request now.",
  timeout: "Timed out waiting for approval in the portal.",
  denied: "Access was denied in the portal.",
} as const;
const MAX_CODE_CHARS = 8192;

function usage(): never {
  console.error(
    "Usage: login [--seal-to <key>] [--account <client_id>] | login --code [--seal-to <key>] [--account <client_id>] | login --use <client_id> | login --logout [<client_id> | all]",
  );
  process.exit(2);
}

/** Reads one line from the terminal without echoing it (S18: never from args, env or a pipe). */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (err?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      // Bracketed-paste markers (ESC[200~ … ESC[201~): the ESC is dropped below, the rest here.
      if (err) reject(err);
      else resolve(value.replace(/\[20[01]~/g, ""));
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003" || ch === "\u0004") return finish(new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch < " ") continue; // ignore other control characters, e.g. paste brackets
        if (value.length >= MAX_CODE_CHARS) return finish(new Error("That code is too long."));
        value += ch;
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
  // `--seal-to <key>` (task 10) may follow the browser login or --code; take it out first.
  const at = args.indexOf("--seal-to");
  const sealArg = at >= 0 ? args.splice(at, 2)[1] ?? "" : undefined;
  // `--account <client_id>`: accept only that Gcore account (browser login or --code).
  const accAt = args.indexOf("--account");
  const accountArg = accAt >= 0 ? args.splice(accAt, 2)[1] ?? "" : undefined;
  const account = accountArg === undefined ? undefined : (parseId(accountArg) ?? usage());
  const [option, value, ...rest] = args;
  if (rest.length) usage();
  const mode = process.env.FASTEDGE_SESSION ?? "";
  if (mode !== "" && mode !== "ephemeral") {
    console.error('login: FASTEDGE_SESSION must be unset or "ephemeral"');
    process.exit(2);
  }
  // Only the config forces ephemeral; `--seal-to` alone lets the page offer "Keep me signed in".
  const forced = mode === "ephemeral";

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

    if (option === "--use") {
      const clientId = parseId(value) ?? usage();
      const session = useCachedAccount({ apiOrigin: GCORE_API_ORIGIN, clientId });
      console.error(`The saved session now points at account ${session.client_id} (expires ${session.expires_at}).`);
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
        code = await readHidden("Paste the connect code from the portal (it won't be shown), then press Enter: ");
      } catch (err: any) {
        console.error(err?.message ?? "Cancelled.");
        process.exit(2);
      }
      const session = connectWithCode(code, { apiOrigin: GCORE_API_ORIGIN, sealTo, forced, account });
      console.error(`FastEdge is connected to account ${session.client_id} until ${session.expires_at}.`);
      // A sealed session belongs to the server that's running; a restart would strand it.
      if (!session.sealed) console.error(`If an MCP server is already running with another account: ${RESTART_HINT}`);
      process.exit(0);
    }

    if (option !== undefined) usage();

    // 0.0.0.0 inside the container; the host publishes it on 127.0.0.1 only.
    const login = await startLogin({ apiOrigin: GCORE_API_ORIGIN, host: "0.0.0.0", port: LOGIN_PORT, sealTo, forced, account });
    if (account !== undefined) {
      console.error(`This sign-in is for Gcore account ${account} only. Make sure the portal is signed in to it before you open the link.`);
    }
    console.error(`Open this URL to approve FastEdge access: ${login.url}`);
    const outcome = await login.result;
    console.error(MESSAGES[outcome]);
    process.exit(EXIT_CODES[outcome]);
  } catch (err) {
    if (err instanceof LoginError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    throw err;
  }
}

// Ctrl-C, or `docker stop` (node runs as PID 1, which ignores SIGTERM by default): exit normally
// so the login lock is released.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main();
