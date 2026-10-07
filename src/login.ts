// `docker run … <image> login [--use <client_id> | --logout | --code]` (PROTOCOL.md §3).
// No workspace mount, no GCORE_API_KEY (S16). Never prints the token (S3).
import { GCORE_API_ORIGIN } from "./api-client.js";
import {
  LoginError,
  connectWithCode,
  logoutActive,
  requireSealKey,
  startLogin,
  useCachedAccount,
} from "./auth/login-server.js";
import { LOGIN_PORT, RESTART_HINT } from "./auth/session.js";

const EXIT_CODES = { ok: 0, timeout: 5, denied: 6 } as const;
const MESSAGES = {
  ok: "FastEdge is connected. You can retry the request now.",
  timeout: "Timed out waiting for approval in the portal.",
  denied: "Access was denied in the portal.",
} as const;
const MAX_CODE_CHARS = 8192;

function usage(): never {
  console.error(
    "Usage: login [--seal-to <key>] | login --code [--seal-to <key>] | login --use <client_id> | login --logout",
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

    if (option === "--use") {
      if (!value || !/^[1-9]\d{0,17}$/.test(value)) usage();
      const session = useCachedAccount({ apiOrigin: GCORE_API_ORIGIN, clientId: Number(value) });
      console.error(`The saved session now points at account ${session.client_id} (expires ${session.expires_at}).`);
      console.error(`An MCP server that's already running keeps its current session: ${RESTART_HINT}`);
      process.exit(0);
    }

    if (option === "--logout") {
      if (value) usage();
      const session = logoutActive({ apiOrigin: GCORE_API_ORIGIN });
      if (!session) {
        console.error("Not signed in.");
      } else {
        console.error(`Removed the saved session for account ${session.client_id} from this computer.`);
        console.error("An MCP server that's already running keeps its current session until you stop or restart it.");
        console.error(
          `The token stays valid until ${session.expires_at}; delete it on the portal's API tokens page to revoke it now.`,
        );
      }
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
      const session = connectWithCode(code, { apiOrigin: GCORE_API_ORIGIN, sealTo, forced });
      console.error(`FastEdge is connected to account ${session.client_id} until ${session.expires_at}.`);
      // A sealed session belongs to the server that's running; a restart would strand it.
      if (!session.sealed) console.error(`If an MCP server is already running with another account: ${RESTART_HINT}`);
      process.exit(0);
    }

    if (option !== undefined) usage();

    // 0.0.0.0 inside the container; the host publishes it on 127.0.0.1 only.
    const login = await startLogin({ apiOrigin: GCORE_API_ORIGIN, host: "0.0.0.0", port: LOGIN_PORT, sealTo, forced });
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
