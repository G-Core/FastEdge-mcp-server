import { GCORE_API_ORIGIN, callGcoreApi, type ApiCallOptions, type ApiCallResult } from "../api-client.js";
import {
  PORTAL_ORIGINS,
  RESTART_HINT,
  SESSION_DIR,
  codeCommand,
  loginCommand,
  manualFallback,
  useCommand,
} from "./session.js";
import { isUsable, listAccounts, readActiveSession, type Session } from "./store.js";

export { TOKEN_PATTERN } from "./store.js";

export type AuthRequiredReason =
  | "no_session"
  | "expired"
  | "account_changed"
  | "origin_mismatch"
  | "rejected"
  | "account_mismatch"
  | "broker_unavailable";
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

/** Metadata safe to show the agent: allowlisted fields, normalised values, never the token. */
function describeSession(session: Session) {
  return {
    client_id: session.client_id,
    api_origin: PORTAL_ORIGINS[session.api_origin] ? session.api_origin : "unsupported origin",
    expires_at: new Date(Date.parse(session.expires_at)).toISOString(),
  };
}

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
  opts: { sessionDir?: string; apiOrigin?: string; now?: () => number } = {},
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
      const me = await callGcoreApi(
        { method: "GET", path: "/iam/clients/me", authHeader: `APIKey ${session.token}` },
        SESSION_LIMITS,
      );
      if (me.status === 401) return { authRequired: "rejected" };
      if (me.status !== 200) {
        return {
          status: me.status >= 400 ? me.status : 502,
          data: { error: `Couldn't confirm which account the session token belongs to (GET /iam/clients/me answered ${me.status}). Try again shortly.` },
        };
      }
      if ((me.data as { id?: unknown } | null)?.id !== session.client_id) return { authRequired: "account_mismatch" };
      verifiedToken = session.token;
      return null;
    })().finally(() => {
      if (verifying?.token === session.token) verifying = undefined;
    });
    verifying = { token: session.token, result };
    return result;
  };

  return {
    resolve,

    async call(call) {
      const c = current();
      if ("authRequired" in c) return c;
      const { session } = c;
      if (session.token !== verifiedToken) {
        const problem = await verify(session);
        if (problem) return problem;
      }
      // Pin only a verified account; a concurrent call may have pinned another meanwhile.
      pinnedClientId ??= session.client_id;
      if (session.client_id !== pinnedClientId) return { authRequired: "account_changed" };

      const result = await callGcoreApi({ ...call, authHeader: `APIKey ${session.token}` }, SESSION_LIMITS);
      // A 403 is a permission problem, not a login problem: pass it through.
      if (result.status === 401) return { authRequired: "rejected" };
      // Never hand the token across the broker boundary, even if an upstream echoes it.
      const token = session.token;
      if (JSON.stringify(result.data ?? null).includes(token)) {
        return { status: 0, data: { error: "The API response was withheld because it contained the session token." } };
      }
      return result;
    },

    status() {
      const at = now();
      const check = checkSession(sessionDir, apiOrigin, at);
      const changed = !("reason" in check) && pinnedClientId !== undefined && check.session.client_id !== pinnedClientId;
      const state = "reason" in check ? check.reason : changed ? "account_changed" : "available";
      return {
        credential: "session",
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
        ...(changed ? { next_step: RESTART_HINT } : {}),
        login_command: command,
        use_command: use,
        // For when the browser can't reach this machine (Codespaces, SSH). The user runs it, never the agent.
        code_command: codeCommand(apiOrigin),
        manual_login: manualFallback(apiOrigin),
        switch_account: command
          ? `If the account is in cached_accounts and usable, run use_command with its client_id; otherwise run login_command and approve while signed in to that account. Then: ${RESTART_HINT}`
          : "Session login is not available for this API origin; set GCORE_API_KEY instead.",
      };
    },
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

  if (reason === "account_changed") {
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
      "Either set GCORE_API_KEY, or sign in through the Gcore portal for a time-limited session:",
      "ask the user for permission, then run this command and give them the URL it prints:",
      `  ${command}`,
      manualFallback(apiOrigin) ?? "",
      opts.detail
        ? "Then retry only what did not complete; no restart is needed."
        : "Then retry this request; no restart is needed.",
    );
  }
  if (opts.detail) lines.push("", opts.detail);

  return { isError: true, content: [{ type: "text" as const, text: lines.join("\n") }] };
}
