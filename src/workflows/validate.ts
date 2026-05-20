import { checkAllowed } from "../policy/enforce.js";
import type { Workflow } from "./types.js";

export interface WorkflowPolicyIssue {
  workflow: string;
  stepIndex: number;
  method: string;
  path: string;
  reason: string;
}

/**
 * Walk every step of every workflow and check it against the runtime policy.
 * Returns a list of issues; empty list means all workflows are compatible
 * with the current src/config/products.ts policy.
 *
 * Workflow step paths often contain templated tokens like `{{params.foo}}`
 * or `$alias.field`; the path-template matcher treats these as wildcards,
 * which is the desired behaviour for an at-load-time structural check.
 */
export function validateWorkflows(
  workflows: Record<string, Workflow>,
): WorkflowPolicyIssue[] {
  const issues: WorkflowPolicyIssue[] = [];
  for (const [name, wf] of Object.entries(workflows)) {
    wf.steps.forEach((step, i) => {
      const denial = checkAllowed(step.method, step.path);
      if (denial) {
        issues.push({
          workflow: name,
          stepIndex: i,
          method: step.method,
          path: step.path,
          reason: denial.reason,
        });
      }
    });
  }
  return issues;
}

export function formatWorkflowIssues(issues: WorkflowPolicyIssue[]): string {
  return issues
    .map(
      (i) =>
        `  - "${i.workflow}" step ${i.stepIndex + 1}: ${i.method} ${i.path} — ${i.reason}`,
    )
    .join("\n");
}
