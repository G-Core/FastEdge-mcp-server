// The `fastedge-session` volume layout (fastedge-coordinator PROTOCOL.md §2). Readers (the MCP
// server, read-only mount) and the writer (the login container) share these helpers.
import fs from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const MAX_FILE_BYTES = 4096;
const LOCK_STALE_MS = 10 * 60_000;
export const EXPIRY_MARGIN_MS = 60_000;
// Printable ASCII only, so a tampered file can't smuggle header syntax.
export const TOKEN_PATTERN = /^[\x21-\x7e]{1,1024}$/;
const INSTALL_ID_PATTERN = /^[0-9a-f]{32}$/;

export interface Session {
  version: 1;
  generation: string;
  token: string;
  token_id: number;
  client_id: number;
  api_origin: string;
  expires_at: string;
  created_at: string;
}

interface ActivePointer {
  version: 1;
  api_origin: string;
  client_id: number;
  generation: string;
}

const hostOf = (origin: string) => new URL(origin).host;
const accountsDir = (dir: string) => join(dir, "accounts");
const accountPath = (dir: string, origin: string, clientId: number) =>
  join(accountsDir(dir), `${hostOf(origin)}_${clientId}.json`);
const activePath = (dir: string, origin: string) => join(dir, `active-${hostOf(origin)}.json`);
const legacyPath = (dir: string) => join(dir, "session.json");

// --- Reading -------------------------------------------------------------------

/** Bounded, symlink-refusing read (O_NOFOLLOW). Anything unusual reads as null. */
function readJson(path: string): unknown {
  let fd: number;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n > MAX_FILE_BYTES) return null;
    return JSON.parse(buf.subarray(0, n).toString("utf8"));
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function parseSession(raw: unknown): Session | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 1) return null;
  if (typeof s.token !== "string" || !TOKEN_PATTERN.test(s.token)) return null;
  if (!isId(s.client_id)) return null;
  if (typeof s.api_origin !== "string" || typeof s.expires_at !== "string") return null;
  if (Number.isNaN(Date.parse(s.expires_at))) return null;
  return s as unknown as Session;
}

function parsePointer(raw: unknown): ActivePointer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.version !== 1 || typeof p.api_origin !== "string" || !isId(p.client_id)) return null;
  if (typeof p.generation !== "string") return null;
  return p as unknown as ActivePointer;
}

const readSession = (path: string) => parseSession(readJson(path));

/**
 * The session this origin should use: the active pointer's account, or legacy `session.json`
 * when there's no pointer yet. The file name is always built here, never taken from a file.
 */
export function readActiveSession(dir: string, origin: string): Session | null {
  const pointer = parsePointer(readJson(activePath(dir, origin)));
  if (!pointer) return readSession(legacyPath(dir));
  if (pointer.api_origin !== origin) return null;
  const session = readSession(accountPath(dir, origin, pointer.client_id));
  return session && session.client_id === pointer.client_id ? session : null;
}

export const isUsable = (session: Session, now: number) =>
  Date.parse(session.expires_at) - now > EXPIRY_MARGIN_MS;

/** Every cached account for this origin. Callers must not expose `token`. */
export function listAccounts(dir: string, origin: string): Session[] {
  const prefix = `${hostOf(origin)}_`;
  let names: string[];
  try {
    names = fs.readdirSync(accountsDir(dir));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => readSession(join(accountsDir(dir), name)))
    .filter((s): s is Session => s !== null && s.api_origin === origin);
}

// --- Writing (login container only) ----------------------------------------------

// The cache is broker-only: build code running as the MCP server's uid must not be able to read
// it (PROTOCOL.md §2, SECURITY.md R1/S15). Directories 0700, files 0600, everywhere.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Creates `dir` (and parents) owner-only; tightens it if it already exists. */
function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  fs.chmodSync(dir, DIR_MODE);
}

/** A fully written, fsynced `0600` temp file in `dir`, ready to be renamed or linked into place. */
function writeTemp(dir: string, content: string): string {
  ensurePrivateDir(dir);
  const tmp = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, FILE_MODE);
    try {
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tmp, FILE_MODE); // independent of the umask
    return tmp;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Temp file + fsync + rename, so a reader never sees a half-written file (S15). */
function writeAtomic(path: string, data: object): void {
  const dir = join(path, "..");
  const tmp = writeTemp(dir, JSON.stringify(data));
  try {
    fs.renameSync(tmp, path);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

const newGeneration = () => randomBytes(16).toString("hex");

function writePointer(dir: string, origin: string, clientId: number): void {
  const pointer: ActivePointer = { version: 1, api_origin: origin, client_id: clientId, generation: newGeneration() };
  writeAtomic(activePath(dir, origin), pointer);
}

/** Account file first, then the active pointer (PROTOCOL.md §2). */
export function saveSession(dir: string, session: Omit<Session, "version" | "generation" | "created_at">): void {
  writeAtomic(accountPath(dir, session.api_origin, session.client_id), {
    version: 1,
    generation: newGeneration(),
    ...session,
    created_at: new Date().toISOString(),
  });
  writePointer(dir, session.api_origin, session.client_id);
}

/** Points the origin at a cached account. Returns it, or null if it isn't usable. */
export function useAccount(dir: string, origin: string, clientId: number, now: number): Session | null {
  const session = readSession(accountPath(dir, origin, clientId));
  if (!session || session.client_id !== clientId || session.api_origin !== origin || !isUsable(session, now)) {
    return null;
  }
  writePointer(dir, origin, clientId);
  return session;
}

/** Removes the active account and its pointer, only if the pointer didn't change meanwhile (S15). */
export function logout(dir: string, origin: string): Session | null {
  const path = activePath(dir, origin);
  const pointer = parsePointer(readJson(path));
  if (!pointer) return null;
  const session = readSession(accountPath(dir, origin, pointer.client_id));
  const again = parsePointer(readJson(path));
  if (!again || again.generation !== pointer.generation) return null;
  fs.rmSync(accountPath(dir, origin, pointer.client_id), { force: true });
  fs.rmSync(path, { force: true });
  return session;
}

/** Moves a POC `session.json` into the per-account layout (once). */
export function migrateLegacy(dir: string): void {
  const session = readSession(legacyPath(dir));
  if (session) {
    let origin: string;
    try {
      origin = new URL(session.api_origin).origin;
    } catch {
      origin = "";
    }
    if (origin === session.api_origin) {
      const target = accountPath(dir, origin, session.client_id);
      if (!readSession(target)) writeAtomic(target, session);
      if (!parsePointer(readJson(activePath(dir, origin)))) writePointer(dir, origin, session.client_id);
    }
  }
  fs.rmSync(legacyPath(dir), { force: true });
}

/** Removes expired account files, and pointers left pointing at nothing. */
export function removeExpired(dir: string, now: number): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(accountsDir(dir));
  } catch {
    // no accounts yet
  }
  for (const name of names) {
    const path = join(accountsDir(dir), name);
    const session = readSession(path);
    if (name.endsWith(".json") && (!session || Date.parse(session.expires_at) <= now)) fs.rmSync(path, { force: true });
  }
  for (const name of fs.readdirSync(dir)) {
    if (!/^active-.+\.json$/.test(name)) continue;
    const pointer = parsePointer(readJson(join(dir, name)));
    if (!pointer || !readSession(accountPath(dir, pointer.api_origin, pointer.client_id))) {
      fs.rmSync(join(dir, name), { force: true });
    }
  }
}

// --- Sealed sessions (task 10, ephemeral mode) ---------------------------------------

/** `sealed/<sha256(raw recipient key)>.json`: one file per broker key, named only from the key. */
const sealedPath = (dir: string, recipient: string) =>
  join(dir, "sealed", `${createHash("sha256").update(Buffer.from(recipient, "base64url")).digest("hex")}.json`);

/** Writes an envelope for `recipient` atomically (`0700` dir, `0600` file). Never plaintext. */
export function writeSealed(dir: string, recipient: string, envelope: object): void {
  ensurePrivateDir(dir);
  writeAtomic(sealedPath(dir, recipient), envelope);
}

/** The envelope sealed to `recipient`, unparsed beyond JSON (bounded, no links), or null. */
export const readSealed = (dir: string, recipient: string): unknown => readJson(sealedPath(dir, recipient));

// --- Lock -----------------------------------------------------------------------

export class LockedError extends Error {}

/** `O_EXCL` lock holding the PID; older than 10 minutes counts as stale. Returns a release function. */
export function acquireLock(dir: string): () => void {
  ensurePrivateDir(dir);
  const path = join(dir, ".lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, FILE_MODE);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      // Also release on process exit (incl. Ctrl-C/`docker stop`, which login.ts turns into an
      // exit), so an interrupted login doesn't block the next one for 10 minutes.
      const release = () => {
        process.off("exit", release);
        fs.rmSync(path, { force: true });
      };
      process.on("exit", release);
      return release;
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      let age = 0;
      try {
        age = Date.now() - fs.lstatSync(path).mtimeMs;
      } catch {
        continue; // released meanwhile; retry
      }
      if (age <= LOCK_STALE_MS) break;
      fs.rmSync(path, { force: true });
    }
  }
  throw new LockedError("Another FastEdge login is in progress. Finish or close it, then try again.");
}

// --- Installation id (task 05) ------------------------------------------------------

function readInstallationId(file: string): string | null {
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const buf = Buffer.alloc(64);
      const id = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8").trim();
      return INSTALL_ID_PATTERN.test(id) ? id : null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * This volume's installation id (PROTOCOL.md §2), created on first use. `link()` makes the first
 * writer win if two logins race; an unreadable or malformed file is replaced.
 */
export function ensureInstallationId(dir: string): string {
  const file = join(dir, "installation_id");
  const existing = readInstallationId(file);
  if (existing) return existing;

  const tmp = writeTemp(dir, randomBytes(16).toString("hex"));
  try {
    try {
      fs.linkSync(tmp, file);
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      const raced = readInstallationId(file);
      if (raced) return raced;
      fs.renameSync(tmp, file);
    }
    const id = readInstallationId(file);
    if (!id) throw new Error("installation id unreadable");
    return id;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
