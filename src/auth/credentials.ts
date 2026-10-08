import { GCORE_API_ORIGIN, callGcoreApi, type ApiCallOptions, type ApiCallResult } from "../api-client.js";
import type { KeyObject } from "node:crypto";

import { open } from "./seal.js";
import {
  EPHEMERAL_RESTART_HINT,
  PORTAL_ORIGINS,
  RESTART_HINT,
  SESSION_DIR,
  codeCommand,
  loginCommand,
  logoutCommand,
  manualFallback,
  useCommand,
} from "./session.js";
import { TOKEN_PATTERN, isUsable, listAccounts, readActiveSession, readSealed, sealedPresent, type Session } from "./store.js";

export { TOKEN_PATTERN } from "./store.js";

export type AuthRequiredReason =
  | "no_session"
  | "expired"
  | "account_changed"
  | "origin_mismatch"
  | "rejected"
  | "account_mismatch"
  | "broker_unavailable"
  | "restart_required";
export type CredentialSource = "explicit" | "session";
export type AuthResolution = { header: string; source: CredentialSource } | { authRequired: AuthRequiredReason };
export type ApiResult = ApiCallResult | { authRequired: AuthRequiredReason };

/** What the API tools use. They never see a credential. */
export interface Auth {
  /** Sends one API call with this server's credential. */
  call(opts: Omit<ApiCallOptions, "authHeader">): Promise<ApiResult>;
  /** Read-only view for the status tool. Never pins, never includes the token. */
  status(): Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** An Auth that holds its credential in this process. */
export interface LocalAuth extends Auth {
  /** Credential for one request. Pins the account on first use of a session. */
  resolve(): AuthResolution;
  status(): Record<string, unknown>;
}

// Session tokens get the broker's transport limits (PROTOCOL.md §2a).
const SESSION_LIMITS = { manualRedirect: true, maxResponseBytes: 16 * 1024 * 1024 };

type SessionCheck =
  | { session: Session }
  | { reason: "no_session" }
  | { reason: "expired" | "origin_mismatch"; session: Session };

/** PROTOCOL.md §2 checks, without account pinning. */
function checkSession(dir: string, apiOrigin: string, now: number): SessionCheck {
  const session = readActiveSession(dir, apiOrigin);
  if (!session) return { reason: "no_session" };
  // S2: the request destination is never taken from the file, only checked against it.
  if (session.api_origin !== apiOrigin) return { reason: "origin_mismatch", session };
  if (!isUsable(session, now)) return { reason: "expired", session };
  return { session };
}

/** Status guidance, so an agent offers the same choices as `auth_required` (§4) instead of picking one. */
const SIGN_IN_HINT =
  "To sign in, ask the user which way: 1. Browser on this computer (recommended): with their OK, run login_command yourself as a background task with your tool's own background option (Claude Code: run_in_background, not a shell `&`), and give them the URL as soon as it's printed (the command then waits for their approval). The page connects whichever account the portal is signed in to and shows it before Approve; tell the user to check it. 2. Remote (SSH, Codespaces): give them manual_login. 3. Not now. Never ask them to paste a token or code into this chat.";

/** Status guidance for "log me out" requests (PROTOCOL §3.7). */
const SIGN_OUT_HINT =
  "To sign out on this computer: with the user's OK, run logout_command with a client_id, or `all` (every saved account, prod and preprod). It removes local sessions only and prints the token ids; tell the user to delete those tokens on the portal's API tokens page to revoke them. A server holding a \"don't keep\" session keeps it until it's stopped or restarted.";

/** Metadata safe to show the agent: allowlisted fields, normalised values, never the token. */
function describeSession(session: Session) {
  return {
    client_id: session.client_id,
    api_origin: PORTAL_ORIGINS[session.api_origin] ? session.api_origin : "unsupported origin",
    expires_at: new Date(Date.parse(session.expires_at)).toISOString(),
  };
}

/** One API call with a session token; a 401 becomes `on401`. Never returns a response containing the token. */
async function callWithToken(
  token: string,
  call: Omit<ApiCallOptions, "authHeader">,
  on401: AuthRequiredReason,
): Promise<ApiResult> {
  const result = await callGcoreApi({ ...call, authHeader: `APIKey ${token}` }, SESSION_LIMITS);
  // A 403 is a permission problem, not a login problem: pass it through.
  if (result.status === 401) return { authRequired: on401 };
  // Never hand the token across the broker boundary, even if an upstream echoes it.
  if (JSON.stringify(result.data ?? null).includes(token)) {
    return { status: 0, data: { error: "The API response was withheld because it contained the session token." } };
  }
  return result;
}

/**
 * The cache only *claims* an account. Ask the API whose token it is (GET /iam/clients/me → `id`,
 * PROTOCOL.md §2a). Null when it matches; otherwise the result to return instead. An IAM outage
 * is an error, never a login prompt or a fallback.
 */
async function checkAccount(token: string, clientId: number): Promise<ApiResult | null> {
  const me = await callGcoreApi({ method: "GET", path: "/iam/clients/me", authHeader: `APIKey ${token}` }, SESSION_LIMITS);
  if (me.status === 401) return { authRequired: "rejected" };
  if (me.status !== 200) {
    return {
      status: me.status >= 400 ? me.status : 502,
      data: { error: `Couldn't confirm which account the session token belongs to (GET /iam/clients/me answered ${me.status}). Try again shortly.` },
    };
  }
  if ((me.data as { id?: unknown } | null)?.id !== clientId) return { authRequired: "account_mismatch" };
  return null;
}

type Recipient = { privateKey: KeyObject; publicKey: string };

// 8 hours (the longest ephemeral option) plus the protocol's 5 minutes of clock skew between the
// portal and this machine, as for the 7-day cap (task 10, MUST 10).
export const EPHEMERAL_MAX_LIFETIME_MS = 8 * 3_600_000 + 5 * 60_000;

/**
 * Opens and checks the session sealed to `recipient` (task 10), without adopting it: the account
 * check comes later. A Session, or why it can't be used.
 */
function openSealed(recipient: Recipient, sessionDir: string, apiOrigin: string, now: number): Session | AuthRequiredReason {
  const payload = open(recipient.privateKey, recipient.publicKey, readSealed(sessionDir, recipient.publicKey));
  if (!payload) return "no_session";
  if (payload.api_origin !== apiOrigin) return "origin_mismatch";
  const expires = Date.parse(payload.expires_at);
  if (!TOKEN_PATTERN.test(payload.token) || Number.isNaN(expires) || payload.client_id <= 0) return "no_session";
  // The 8 h cap, again at adoption: a planted envelope can't hold a longer session.
  if (expires - now > EPHEMERAL_MAX_LIFETIME_MS) return "no_session";
  const session: Session = { version: 1, generation: "sealed", ...payload };
  return isUsable(session, now) ? session : "expired";
}

/** Status lines for a run that holds (or is about to adopt) a sealed session. */
const EPHEMERAL_NOTE =
  "Ephemeral session: the token is sealed to this server's in-memory key and is never stored in a usable form. It ends when the MCP server stops. While it runs, switching accounts or renewing means restarting the server first, then approving again.";

/**
 * An explicit key always wins and the session cache is never read (S1). Without one, the
 * active session is re-read and validated on every call, and the first accepted account is
 * pinned for the life of the process (S5); a 401 on the session token becomes `rejected`.
 *
 * Session mode reads the token cache, so only the token broker runs it. The MCP server
 * uses `connectBroker` instead and never reads the cache. `sessionDir`, `apiOrigin` and
 * `now` are test hooks.
 */
export function createAuth(
  explicitKey: string,
  opts: { sessionDir?: string; apiOrigin?: string; now?: () => number; recipient?: Recipient } = {},
): LocalAuth {
  const apiOrigin = opts.apiOrigin ?? GCORE_API_ORIGIN;
  const command = loginCommand(apiOrigin);
  const use = useCommand(apiOrigin);

  if (explicitKey) {
    const header = `APIKey ${explicitKey}`;
    return {
      resolve: () => ({ header, source: "explicit" }),
      call: (call) => callGcoreApi({ ...call, authHeader: header }),
      status: () => ({
        credential: "explicit_key",
        note: "GCORE_API_KEY is set, so the session cache is not used. The account is not known locally.",
      }),
    };
  }

  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const now = opts.now ?? Date.now;
  let pinnedClientId: number | undefined;
  // The token whose account the API confirmed, and a check in progress (shared by concurrent calls).
  let verifiedToken: string | undefined;
  let verifying: { token: string; result: Promise<ApiResult | null> } | undefined;

  // Task 10 v2: with a recipient key, a "don't keep" login seals its token to this broker. One
  // credential state and one pin for both sources (MoM rule 3): until a sealed token is adopted,
  // every call checks our sealed file first and falls back to plaintext only if it's absent (rule 2).
  // Once adopted, the run is ephemeral for good: no more disk reads; expiry or a 401 → restart.
  const recipient = opts.recipient;
  let sealed: Session | undefined;
  let sealedEnded = false;
  let sealing: Promise<"absent" | AuthRequiredReason | ApiResult | null> | undefined;
  const sealedOver = () => sealedEnded || (sealed !== undefined && !isUsable(sealed, now()));

  const trySealed = (): Promise<"absent" | AuthRequiredReason | ApiResult | null> => {
    sealing ??= (async (): Promise<"absent" | AuthRequiredReason | ApiResult | null> => {
      if (!recipient || !sealedPresent(sessionDir, recipient.publicKey)) return "absent";
      const c = openSealed(recipient, sessionDir, apiOrigin, now());
      if (typeof c === "string") return c; // present but unusable: blocks plaintext
      if (pinnedClientId !== undefined && c.client_id !== pinnedClientId) return "account_changed";
      const problem = await checkAccount(c.token, c.client_id);
      if (problem) return problem;
      // A plaintext call may have pinned an account while we waited.
      if (pinnedClientId !== undefined && c.client_id !== pinnedClientId) return "account_changed";
      sealed = c;
      pinnedClientId = c.client_id;
      return null;
    })().finally(() => (sealing = undefined));
    return sealing;
  };

  /** The usable session, checked against the pin without setting it. */
  const current = (): { session: Session } | { authRequired: AuthRequiredReason } => {
    const check = checkSession(sessionDir, apiOrigin, now());
    if ("reason" in check) return { authRequired: check.reason };
    if (pinnedClientId !== undefined && check.session.client_id !== pinnedClientId) {
      return { authRequired: "account_changed" };
    }
    return { session: check.session };
  };

  const resolve = (): AuthResolution => {
    if (sealed) return sealedOver() ? { authRequired: "restart_required" } : { header: `APIKey ${sealed.token}`, source: "session" };
    const c = current();
    if ("authRequired" in c) return c;
    pinnedClientId ??= c.session.client_id;
    return { header: `APIKey ${c.session.token}`, source: "session" };
  };

  /**
   * The cache file only *claims* an account. Before a token's first use, ask the API whose it is
   * (GET /iam/clients/me → `id`), so a planted or mislabelled token can't pass as the pinned
   * account. Null when it matches; otherwise the result to return instead. An IAM outage is an
   * error, never a login prompt or a fallback.
   */
  const verify = (session: Session): Promise<ApiResult | null> => {
    if (verifying?.token === session.token) return verifying.result;
    const result = (async (): Promise<ApiResult | null> => {
      const problem = await checkAccount(session.token, session.client_id);
      if (!problem) verifiedToken = session.token;
      return problem;
    })().finally(() => {
      if (verifying?.token === session.token) verifying = undefined;
    });
    verifying = { token: session.token, result };
    return result;
  };

  const call = async (req: Omit<ApiCallOptions, "authHeader">): Promise<ApiResult> => {
    if (recipient && !sealed) {
      const r = await trySealed();
      if (r !== "absent" && r !== null) return typeof r === "string" ? { authRequired: r } : r;
    }
    if (sealed) {
      if (sealedOver()) return { authRequired: "restart_required" };
      const result = await callWithToken(sealed.token, req, "restart_required");
      if ("authRequired" in result) sealedEnded = true;
      return result;
    }

    const c = current();
    if ("authRequired" in c) return c;
    const { session } = c;
    if (session.token !== verifiedToken) {
      const problem = await verify(session);
      if (problem) return problem;
    }
    // A sealed token adopted while we waited wins (a fresh "don't keep" login), but only for the
    // account this request was for; never retarget a request to another account.
    const adoptedMeanwhile = sealed as Session | undefined; // set by a concurrent call during the await
    if (adoptedMeanwhile) return adoptedMeanwhile.client_id === session.client_id ? call(req) : { authRequired: "account_changed" };
    // Pin only a verified account; a concurrent call may have pinned another meanwhile.
    pinnedClientId ??= session.client_id;
    if (session.client_id !== pinnedClientId) return { authRequired: "account_changed" };

    // A 401 here concerns this plaintext token only, never a sealed one adopted meanwhile.
    return callWithToken(session.token, req, "rejected");
  };

  /** Status for a run holding, or about to adopt, a sealed session. Null when there is none. */
  const sealedStatus = (): Record<string, unknown> | null => {
    let session = sealed;
    let pending: AuthRequiredReason | undefined;
    if (!session) {
      if (!recipient || !sealedPresent(sessionDir, recipient.publicKey)) return null;
      const c = openSealed(recipient, sessionDir, apiOrigin, now());
      if (typeof c === "string") pending = c;
      else session = c;
    }
    const blocked = !sealed && session !== undefined && pinnedClientId !== undefined && session.client_id !== pinnedClientId;
    const state = sealed ? (sealedOver() ? "restart_required" : "available") : blocked ? "account_changed" : session ? "available" : pending!;
    return {
      credential: "session",
      mode: "ephemeral",
      forced: false,
      state,
      active_session: session ? describeSession(session) : null,
      account_verified: sealed !== undefined,
      pinned_client_id: pinnedClientId ?? null,
      note: EPHEMERAL_NOTE,
      ...(session ? {} : { sign_in: SIGN_IN_HINT, login_command: command, code_command: codeCommand(apiOrigin), manual_login: manualFallback(apiOrigin) }),
      ...(state === "restart_required" ? { next_step: EPHEMERAL_RESTART_HINT } : {}),
      ...(blocked ? { next_step: RESTART_HINT } : {}),
      logout_command: logoutCommand(apiOrigin),
      sign_out: SIGN_OUT_HINT,
    };
  };

  return {
    resolve,
    call,

    status() {
      const eph = sealedStatus();
      if (eph) return eph;
      const at = now();
      const check = checkSession(sessionDir, apiOrigin, at);
      const changed = !("reason" in check) && pinnedClientId !== undefined && check.session.client_id !== pinnedClientId;
      const state = "reason" in check ? check.reason : changed ? "account_changed" : "available";
      return {
        credential: "session",
        mode: "persistent",
        forced: false,
        state,
        active_session: "session" in check ? describeSession(check.session) : null,
        // Whether the API confirmed the active session's token belongs to its account (checked on first use).
        account_verified: "session" in check && check.session.token === verifiedToken,
        // The account this server process is locked to; null until the first API call.
        pinned_client_id: pinnedClientId ?? null,
        cached_accounts: listAccounts(sessionDir, apiOrigin).map((s) => ({
          ...describeSession(s),
          usable: isUsable(s, at),
        })),
        note: "Accounts and expiry come from the local cache; account_verified says whether the API confirmed the active token's account. Tokens can still have been revoked in the portal.",
        ...(state === "available" ? {} : { sign_in: SIGN_IN_HINT }),
        ...(changed ? { next_step: RESTART_HINT } : {}),
        login_command: command,
        use_command: use,
        logout_command: logoutCommand(apiOrigin),
        sign_out: SIGN_OUT_HINT,
        // For when the browser can't reach this machine (Codespaces, SSH). The user runs it, never the agent.
        code_command: codeCommand(apiOrigin),
        manual_login: manualFallback(apiOrigin),
        // Only a different account needs a restart (S5 pins one per process); agents over-apply it otherwise.
        renew_session: command
          ? "If the session expired or was rejected, run login_command and approve for the same account. No restart is needed: retry the request."
          : "Session login is not available for this API origin; set GCORE_API_KEY instead.",
        // Restart first, then sign in: a "don't keep" approval is sealed to the server that's running
        // now, so approving before a restart would strand it.
        switch_account: command
          ? `Only to use a different account: if it is in cached_accounts and usable, run use_command with its client_id, then: ${RESTART_HINT} Otherwise, in this order: 1) the user switches the portal (in the browser they'll approve in) to that account, because approval connects whichever account the portal is signed in to; 2) restart this MCP server; 3) sign in, and the user checks the account shown on the Approve page before approving.`
          : "Session login is not available for this API origin; set GCORE_API_KEY instead.",
      };
    },
  };
}

/**
 * Ephemeral session mode (fastedge-coordinator tasks/10-ephemeral-session.md, v1). The broker holds
 * an X25519 key in memory; login seals the approved token to it. The broker adopts one token per
 * lifetime: it reads only its own sealed file, checks the account, and from then on never reads the
 * volume again. Expiry or a 401 means restart, never a re-read. It never reads the plaintext cache.
 * `sessionDir`, `apiOrigin` and `now` are test hooks.
 */
export function createEphemeralAuth(opts: {
  recipient: { privateKey: KeyObject; publicKey: string };
  sessionDir?: string;
  apiOrigin?: string;
  now?: () => number;
}): LocalAuth {
  const apiOrigin = opts.apiOrigin ?? GCORE_API_ORIGIN;
  const sessionDir = opts.sessionDir ?? SESSION_DIR;
  const now = opts.now ?? Date.now;
  let adopted: Session | undefined;
  let ended = false; // a 401 on the adopted token: nothing is sent with it again
  let adopting: Promise<AuthRequiredReason | ApiResult | null> | undefined;
  const over = () => ended || (adopted !== undefined && !isUsable(adopted, now()));

  /** Reads and opens our sealed file. Not adopted until the account check passes. */
  const candidate = () => openSealed(opts.recipient, sessionDir, apiOrigin, now());

  /** Serialized: concurrent first calls share one adoption. */
  const adopt = (): Promise<AuthRequiredReason | ApiResult | null> => {
    adopting ??= (async () => {
      const c = candidate();
      if (typeof c === "string") return c;
      const problem = await checkAccount(c.token, c.client_id);
      if (problem) return problem;
      adopted = c;
      return null;
    })().finally(() => (adopting = undefined));
    return adopting;
  };

  const status = () => {
    // Before adoption, look at the sealed file without adopting it: adoption needs the account
    // check, which only an API call makes (as in normal mode, where status doesn't verify either).
    const pending = adopted ? undefined : candidate();
    const session = adopted ?? (typeof pending === "object" ? pending : undefined);
    const state = adopted ? (over() ? "restart_required" : "available") : session ? "available" : (pending as AuthRequiredReason);
    return {
      credential: "session",
      mode: "ephemeral",
      forced: true,
      state,
      active_session: session ? describeSession(session) : null,
      // Whether the API confirmed the token's account; for a sealed token, on the first API call.
      account_verified: adopted !== undefined,
      pinned_client_id: adopted?.client_id ?? null,
      note: EPHEMERAL_NOTE,
      ...(session ? {} : { sign_in: SIGN_IN_HINT, login_command: loginCommand(apiOrigin), code_command: codeCommand(apiOrigin), manual_login: manualFallback(apiOrigin) }),
      ...(state === "restart_required" ? { next_step: EPHEMERAL_RESTART_HINT } : {}),
      logout_command: logoutCommand(apiOrigin),
      sign_out: SIGN_OUT_HINT,
    };
  };

  return {
    resolve: () => {
      if (!adopted) return { authRequired: "no_session" };
      if (over()) return { authRequired: "restart_required" };
      return { header: `APIKey ${adopted.token}`, source: "session" };
    },

    async call(call) {
      if (!adopted) {
        const problem = await adopt();
        if (typeof problem === "string") return { authRequired: problem };
        if (problem) return problem;
      }
      if (over()) return { authRequired: "restart_required" };
      const result = await callWithToken(adopted!.token, call, "restart_required");
      if ("authRequired" in result) ended = true;
      return result;
    },

    status,
  };
}

/** PROTOCOL.md §4. Metadata only: never the token or the file contents (S3). */
export function authRequiredResult(
  reason: AuthRequiredReason,
  opts: { apiOrigin?: string; detail?: string } = {},
) {
  const apiOrigin = opts.apiOrigin ?? GCORE_API_ORIGIN;
  const command = loginCommand(apiOrigin);
  const lines = [`FastEdge is not connected to a Gcore account (${reason}).`];

  if (reason === "restart_required") {
    lines.push(
      "This ephemeral session has ended (it expired or was revoked). Ephemeral sessions are never renewed while the MCP server runs.",
      "Don't run a login command now.",
      EPHEMERAL_RESTART_HINT,
    );
  } else if (reason === "account_changed") {
    lines.push("A login for a different account replaced the session this server was using.", RESTART_HINT);
  } else if (reason === "broker_unavailable") {
    lines.push(
      "The token broker that holds the session is not running, so this server can't use it.",
      "Logging in again won't help. Restart the MCP server, or set GCORE_API_KEY.",
      "(Session login only works in the FastEdge MCP server's Docker image.)",
    );
  } else if (!command) {
    lines.push("Session login is not available for this API origin. Set GCORE_API_KEY instead.");
  } else {
    if (reason === "account_mismatch") {
      lines.push(
        "The API says the cached session token belongs to a different Gcore account than the session claims, so it was not used.",
        "The session cache may have been tampered with. Log in again; if this happens again, stop and tell the user.",
      );
    }
    if (reason === "rejected") {
      lines.push(
        "The API rejected the session token (it may have been revoked in the portal).",
        "If a fresh login is rejected too, stop and tell the user instead of logging in again.",
      );
    }
    lines.push(
      "Sign in through the Gcore portal for a time-limited session (or set GCORE_API_KEY instead).",
      "Ask the user how to sign in. If you can ask a multiple-choice question, offer these three",
      "choices; otherwise list them:",
      "1. Browser on this computer (recommended): with their OK, run this command yourself as a",
      "   background task, using your tool's own background option (Claude Code: run_in_background),",
      "   not a shell `&`. It prints a URL, then waits up to 5 minutes on a local port for their",
      "   approval in the portal (a one-time handoff, not OAuth). Read its output and give them the URL",
      "   as soon as it's printed. The page connects whichever Gcore account the portal is signed in",
      "   to, and shows it before Approve: if it's the wrong one, they switch accounts in the portal",
      "   first, then open the link:",
      `   ${command}`,
      // Same portal mapping as the login command, so it is never null here.
      "2. Remote (SSH, a Codespace, or a browser that can't reach this computer):",
      manualFallback(apiOrigin)!,
      "3. Not now: stop, and don't retry the request.",
      opts.detail
        ? "After 1 or 2, retry only what did not complete; no restart is needed."
        : "After 1 or 2, retry this request; no restart is needed.",
    );
  }
  if (opts.detail) lines.push("", opts.detail);

  return { isError: true, content: [{ type: "text" as const, text: lines.join("\n") }] };
}
