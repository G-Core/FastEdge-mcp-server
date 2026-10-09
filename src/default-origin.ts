// Run by the root entrypoint in session mode when GCORE_API_BASE is unset (task 11, PROTOCOL.md
// §2a): prints the saved default origin, or nothing when there isn't one. A saved file that's
// unreadable, malformed, or names an origin without session login exits 2, so startup stops
// instead of falling back to the baked default. Started like the broker: env -i, uid 10002.
import { ALLOWED_API_ORIGINS } from "./api-client.js";
import { PORTAL_ORIGINS, SESSION_DIR } from "./auth/session.js";
import { readDefaultOrigin } from "./auth/store.js";

const origin = readDefaultOrigin(SESSION_DIR, (o) => ALLOWED_API_ORIGINS.has(o) && o in PORTAL_ORIGINS);
if (origin === "invalid") {
  // Fixed text: never echo the file.
  console.error("default-origin: the saved default environment is invalid");
  process.exit(2);
}
if (origin) process.stdout.write(origin);
