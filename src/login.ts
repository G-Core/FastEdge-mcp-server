// `docker run … <image> login [--use <client_id> | --logout]` (PROTOCOL.md §3).
// No workspace mount, no GCORE_API_KEY (S16). Never prints the token (S3).
import { GCORE_API_ORIGIN } from "./api-client.js";
import { LoginError, logoutActive, startLogin, useCachedAccount } from "./auth/login-server.js";
import { LOGIN_PORT, RESTART_HINT } from "./auth/session.js";

const EXIT_CODES = { ok: 0, timeout: 5, denied: 6 } as const;
const MESSAGES = {
  ok: "FastEdge is connected. You can retry the request now.",
  timeout: "Timed out waiting for approval in the portal.",
  denied: "Access was denied in the portal.",
} as const;

function usage(): never {
  console.error("Usage: login | login --use <client_id> | login --logout");
  process.exit(2);
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

main();
