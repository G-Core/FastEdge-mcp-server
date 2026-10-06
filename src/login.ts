// `docker run … <image> login [--use <client_id> | --logout | --code]` (PROTOCOL.md §3).
// No workspace mount, no GCORE_API_KEY (S16). Never prints the token (S3).
import { GCORE_API_ORIGIN } from "./api-client.js";
import { LoginError, connectWithCode, logoutActive, startLogin, useCachedAccount } from "./auth/login-server.js";
import { LOGIN_PORT, RESTART_HINT } from "./auth/session.js";

const EXIT_CODES = { ok: 0, timeout: 5, denied: 6 } as const;
const MESSAGES = {
  ok: "FastEdge is connected. You can retry the request now.",
  timeout: "Timed out waiting for approval in the portal.",
  denied: "Access was denied in the portal.",
} as const;
const MAX_CODE_CHARS = 8192;

function usage(): never {
  console.error("Usage: login | login --use <client_id> | login --logout | login --code");
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
  const [option, value, ...rest] = process.argv.slice(2);
  if (rest.length) usage();

  try {
    if (option === "--use") {
      if (!value || !/^[1-9]\d{0,17}$/.test(value)) usage();
      const session = useCachedAccount({ apiOrigin: GCORE_API_ORIGIN, clientId: Number(value) });
      console.error(`Switched to account ${session.client_id} (session expires ${session.expires_at}).`);
      console.error(`If an MCP server is already running: ${RESTART_HINT}`);
      process.exit(0);
    }

    if (option === "--logout") {
      if (value) usage();
      const session = logoutActive({ apiOrigin: GCORE_API_ORIGIN });
      if (!session) {
        console.error("Not signed in.");
      } else {
        console.error(`Signed out of account ${session.client_id} on this computer.`);
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
      const session = connectWithCode(code, { apiOrigin: GCORE_API_ORIGIN });
      console.error(`FastEdge is connected to account ${session.client_id} until ${session.expires_at}.`);
      console.error(`If an MCP server is already running with another account: ${RESTART_HINT}`);
      process.exit(0);
    }

    if (option !== undefined) usage();

    // 0.0.0.0 inside the container; the host publishes it on 127.0.0.1 only.
    const login = await startLogin({ apiOrigin: GCORE_API_ORIGIN, host: "0.0.0.0", port: LOGIN_PORT });
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
