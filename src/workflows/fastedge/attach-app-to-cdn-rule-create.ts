import type { Workflow } from "../types.js";

export const attachAppToCdnRuleCreate: Workflow = {
  name: "attach-app-to-cdn-rule-create",
  description:
    "Enable debug logging on a FastEdge app and create a new CDN rule wiring it to a resource at a given path. Use the *-update sibling workflow if a rule already exists at the target path.",
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
      description: "ID of the CDN resource that will host the rule",
    },
    rule_name: {
      type: "string",
      required: true,
      description: "Human-readable rule name (e.g. 'livetest-helloWorld')",
    },
    rule_path: {
      type: "string",
      required: true,
      description: "Rule path pattern matched on incoming requests (e.g. '/livetest-helloWorld/')",
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
      method: "POST",
      path: "/cdn/resources/{{params.resource_id}}/rules",
      description: "Create the CDN rule wiring the app at the given path",
      body: {
        name: "{{params.rule_name}}",
        rule: "{{params.rule_path}}",
        ruleType: 0,
        originProtocol: "MATCH",
        options: {
          fastedge: "{{params.fastedge_options}}",
        },
      },
      as: "rule",
    },
  ],
  notes:
    "Used by the live-test skill when no existing rule matches the target path on the resource. " +
    "Caller is responsible for ensuring no rule already exists at this path — POST creates a new rule unconditionally. " +
    "Step results: $app.debug_until (RFC3339 window expiry), $rule.id (the created rule's ID — store for future *-update calls).",
};
