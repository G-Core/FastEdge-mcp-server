import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ToolOptions } from "../index.js";
import {
  registerCreateBoilerPlateCode,
  registerListAvailableTemplates,
} from "./scaffolds.js";

/**
 * Available FastEdge templates for Zod schema validation.
 *
 * Note: This list is used for input validation in the scaffold tool schema.
 * The actual template list with descriptions and language support is fetched
 * dynamically from `create-fastedge-app --list-templates` to ensure it's always
 * up-to-date. If you add new templates to create-fastedge-app, update this array
 * to match.
 */
export const availableFastEdgeTemplates = [
  "http-base",
  "http-react",
  "http-react-hono",
  "cdn-base",
] as const;

export function registerScaffoldTools(server: McpServer, options: ToolOptions) {
  registerCreateBoilerPlateCode(server, options);
  registerListAvailableTemplates(server, options);
}
