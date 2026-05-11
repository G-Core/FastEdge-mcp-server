import type { Workflow } from "./types.js";
import { createApp } from "./fastedge/create-app.js";
import { updateAppBinary } from "./fastedge/update-app-binary.js";
import { enableAppHttp } from "./fastedge/enable-app-http.js";
import { attachAppToCdnRuleCreate } from "./fastedge/attach-app-to-cdn-rule-create.js";
import { attachAppToCdnRuleUpdate } from "./fastedge/attach-app-to-cdn-rule-update.js";
import { validateWorkflows, formatWorkflowIssues } from "./validate.js";

export const workflows: Record<string, Workflow> = {
  [createApp.name]: createApp,
  [updateAppBinary.name]: updateAppBinary,
  [enableAppHttp.name]: enableAppHttp,
  [attachAppToCdnRuleCreate.name]: attachAppToCdnRuleCreate,
  [attachAppToCdnRuleUpdate.name]: attachAppToCdnRuleUpdate,
};

const _policyIssues = validateWorkflows(workflows);
if (_policyIssues.length > 0) {
  throw new Error(
    `Workflow registry contains ${_policyIssues.length} step(s) that violate the access policy in src/config/products.ts. ` +
      `Either grant the needed access (writableTags / allowedPaths) or remove the offending workflow:\n` +
      formatWorkflowIssues(_policyIssues),
  );
}
