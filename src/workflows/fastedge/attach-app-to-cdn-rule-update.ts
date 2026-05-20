import type { Workflow } from "../types.js";

export const attachAppToCdnRuleUpdate: Workflow = {
  name: "attach-app-to-cdn-rule-update",
  description:
    "Enable debug logging on a FastEdge app and update an existing CDN rule's FastEdge wiring. Use the *-create sibling workflow if no rule exists yet at the target path.",
  domain: "fastedge",
  params: {
    app_id: {
      type: "number",
      required: true,
      description: "ID of the FastEdge app to attach",
    },
    resource_id: {
      type: "number",
      required: true,
      description: "ID of the CDN resource hosting the rule",
    },
    rule_id: {
      type: "number",
      required: true,
      description: "ID of the existing CDN rule to update",
    },
    fastedge_options: {
      type: "record",
      required: true,
      description:
        "Pre-built options.fastedge body — caller decides which hook phases to wire. The CDN supports four phases: on_request_headers, on_request_body, on_response_headers, on_response_body (at least one must be set). Caller constructs this from the app_id and the desired hook policy.",
    },
  },
  steps: [
    {
      method: "PATCH",
      path: "/fastedge/v1/apps/{{params.app_id}}",
      description: "Enable debug logging on the app (auto-disables after 30 minutes)",
      body: {
        debug: true,
      },
      as: "app",
    },
    {
      method: "PATCH",
      path: "/cdn/resources/{{params.resource_id}}/rules/{{params.rule_id}}",
      description: "Update the existing CDN rule's FastEdge wiring",
      body: {
        options: {
          fastedge: "{{params.fastedge_options}}",
        },
      },
      as: "rule",
    },
  ],
  notes:
    "Used by the live-test skill on iterative re-runs when a rule already exists at the target path. " +
    "PATCH semantics: the body merges with existing rule state — non-mentioned fields are preserved. " +
    "Step results: $app.debug_until (RFC3339 window expiry), $rule.id (echoed back).",
};
