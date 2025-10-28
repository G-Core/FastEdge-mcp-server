import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ToolOptions } from "../index.js";
import {
  registerCreateBoilerPlateCode,
  registerListAvailableTemplates,
} from "./scaffolds.js";

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
