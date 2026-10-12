// FASTEDGE_SESSION, read once at startup: unset (each sign-in chooses) or "ephemeral" (every
// sign-in is sealed to the broker, no choice). Any other value is refused by each entry point.
const raw = process.env.FASTEDGE_SESSION ?? "";

export const SESSION_MODE_VALID = raw === "" || raw === "ephemeral";
export const FORCED_EPHEMERAL = raw === "ephemeral";
export const SESSION_MODE_ERROR = 'FASTEDGE_SESSION must be unset or "ephemeral"';
