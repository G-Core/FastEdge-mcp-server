export interface WorkflowParam {
  type: "string" | "number" | "boolean" | "record";
  required: boolean;
  description: string;
  default?: unknown;
}

export interface WorkflowStep {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  query?: Record<string, string>;
  body?: unknown;
  as?: string;
  content_type?: string;
}

export interface Workflow {
  name: string;
  description: string;
  domain: string;
  params: Record<string, WorkflowParam>;
  steps: WorkflowStep[];
  notes?: string;
}
