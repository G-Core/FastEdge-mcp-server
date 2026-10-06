// `docker run … <image> login` (PROTOCOL.md §3). No workspace mount, no GCORE_API_KEY (S16).
// ponytail: no lock (exit 3), --logout or --status yet; add before release (POC.md, Stage 1).
import { GCORE_API_ORIGIN } from "./api-client.js";
import { LoginError, startLogin } from "./auth/login-server.js";
import { LOGIN_PORT } from "./auth/session.js";

const EXIT_CODES = { ok: 0, timeout: 5, denied: 6 } as const;
const MESSAGES = {
  ok: "FastEdge is connected for 8 hours. You can retry the request now.",
  timeout: "Timed out waiting for approval in the portal.",
  denied: "Access was denied in the portal.",
} as const;

async function main() {
  if (process.argv.length > 2) {
    console.error(`Unsupported option: ${process.argv[2]}`);
    process.exit(2);
  }

  try {
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
