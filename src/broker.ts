// Token broker process (fastedge-coordinator PROTOCOL.md §2a). docker-entrypoint.sh starts it
// as uid 10002 with no capabilities, no groups and a clean environment. It is the only process
// that reads the session cache; the MCP server and its build tools only reach it over one
// socket connection, and never see the token.
import fs from "node:fs";
import net from "node:net";

import { createAuth } from "./auth/credentials.js";
import { BROKER_ID, BROKER_READY_FIFO, BROKER_SOCKET, readIdentity, serveBroker } from "./auth/broker.js";

const CONNECT_DEADLINE_MS = 30_000;

function fail(message: string): never {
  console.error(`token broker: ${message}`);
  process.exit(2);
}

const me = readIdentity();
const all = (ids: number[]) => ids.length === 4 && ids.every((id) => id === BROKER_ID);
if (!all(me.uids) || !all(me.gids) || !me.dropped) fail("not running as the broker user with every privilege dropped");

const auth = createAuth("");
let connected = false;

const listener = net.createServer((conn) => {
  // Single connection (MUST 9): stop listening and remove the socket before serving anything.
  if (connected) return void conn.destroy();
  connected = true;
  listener.close();
  fs.rmSync(BROKER_SOCKET, { force: true });
  clearTimeout(deadline);
  // Fail closed: when the server's connection ends, so does the broker. Nothing re-listens.
  conn.on("close", () => process.exit(0));
  serveBroker(conn, auth);
});

const deadline = setTimeout(() => fail("the MCP server did not connect"), CONNECT_DEADLINE_MS);

fs.rmSync(BROKER_SOCKET, { force: true });
listener.listen(BROKER_SOCKET, () => {
  fs.chmodSync(BROKER_SOCKET, 0o666);
  fs.writeFileSync(BROKER_READY_FIFO, "ready");
});
