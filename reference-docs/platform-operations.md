# Operational Knobs

Some FastEdge platform settings are short-lived or have time-bounded behavior an agent must surface to the user before acting. This document collects those — settings that won't be obvious from the API schema alone but materially affect what works at any given moment.

## Debug Logging — 30-Minute Auto-Expire

By default, FastEdge apps in production do not capture verbose logs. To collect log output from a deployed app, the `debug` flag must be set to `true` on the app. Once enabled:

- The platform begins capturing `console.log` / `eprintln!` / `log::*` output from the app for **30 minutes**.
- The expiration timestamp is exposed as `debug_until` (RFC3339 datetime) in the app detail response.
- After 30 minutes, the platform auto-disables debug to prevent ongoing performance impact. To extend the window, re-enable.
- Logs captured during the window are read via `GET /fastedge/v1/apps/{app_id}/logs`.

### Enabling Debug

```bash
curl -X PATCH "https://api.gcore.com/fastedge/v1/apps/<app-id>" \
  -H "Authorization: APIKey $GCORE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"debug": true}'
```

The app's response body will include `debug_until` set roughly 30 minutes in the future:

```json
{
  "id": 781546,
  "name": "ab-testing",
  "debug_until": "2026-04-27T14:35:00Z",
  ...
}
```

### Reading Logs

```bash
curl -X GET "https://api.gcore.com/fastedge/v1/apps/<app-id>/logs?from=<rfc3339>&to=<rfc3339>" \
  -H "Authorization: APIKey $GCORE_API_KEY"
```

`from` defaults to one hour ago and `to` defaults to the current UTC time if omitted. Other available filters: `edge` (PoP name), `client_ip`, `request_id`, `search` (substring match), plus `sort` / `limit` / `offset` for pagination.

### Operational Order

The mechanism is record-then-replay: logs are only populated for traffic that hits the app **while debug is on**. The correct order is therefore:

1. **Enable debug first** — `PATCH /fastedge/v1/apps/{app_id}` with `{"debug": true}`
2. **Then trigger the request(s) you want to capture** — production traffic, a curl probe, an end-to-end test, etc.
3. **Then read logs** — `GET /fastedge/v1/apps/{app_id}/logs`

Reading `/logs` before enabling debug returns nothing (or only any older entries that happened to be captured during a previous debug window). Reading `/logs` after the 30-minute window has expired still works for entries captured *during* the window, but no new entries accumulate until debug is re-enabled.

### Agent-Side Behavior

When the user asks to investigate a deployed app's behavior — debugging, tailing logs, or reproducing an edge issue — confirm the debug flag state before suggesting steps that depend on log output. If the app's `debug_until` is unset, in the past, or close to expiring, surface that and offer to re-enable. Don't paste the `/logs` curl command without first checking whether the recording window will actually contain data.

A reasonable script:

> "Before tailing logs, I'd recommend enabling debug on app `<name>` — currently `debug_until` is `<value-or-unset>`. Want me to PATCH `debug: true`? It auto-disables after 30 minutes. Then trigger the request(s) you want to capture, and we can read `/apps/<id>/logs` afterwards."

### Operational Notes

- **Performance impact.** The 30-minute auto-expire exists because verbose logging adds per-request overhead. Don't leave debug on indefinitely; the auto-expire is a feature, not a bug to work around with cron jobs.
- **`debug_until` is read-only on response.** It is computed by the platform when `debug: true` is set. You cannot directly set `debug_until` to extend the window — re-PATCH `debug: true` to reset to a fresh 30 minutes.
- **Disabling early.** PATCH `{"debug": false}` to turn it off before the 30-minute auto-expire if you no longer need capture.
- **Per-app scope.** The flag is per-app, not per-account. If you have multiple FastEdge apps and need logs from several, enable each individually.
- **Logs survive auto-disable.** Entries captured during the active window remain queryable via `/logs` after debug auto-disables. The auto-disable stops *new* capture; it doesn't purge old entries.

## See Also

- The deploy and manage skills — for triggering `debug: true` PATCH and reading `/logs` programmatically.
- Platform overview — request lifecycle, app statuses, error codes.
- CDN integration — for CDN apps, the same `debug` mechanism applies on the FastEdge app being attached; the CDN proxy layer's traffic that fires the app's hooks counts as the "request" that produces log entries.
