import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dedent from "dedent";

export function registerScaffoldingPrompts(server: McpServer) {
  // NOTE: The main /createFastEdgeApp prompt has been moved to scaffolding-scenarios.ts
  // This file now only contains the template explanation prompt

  server.registerPrompt(
    "explainFastEdgeTemplate",
    {
      title: "Explain FastEdge template options",
      description:
        "Get detailed explanations of available FastEdge templates and their use cases",
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: dedent`
                Please explain the available FastEdge application templates and help me understand which one is best for my use case.

                Use: list-fastedge-templates tool to get the list of available templates.

                For each template, explain:
                1. What it does
                2. When to use it
                3. Key features
                4. Language and application type
                5. Example use cases

                Note: Generated projects include .claude/skills/ with comprehensive FastEdge documentation.
              `,
            },
          },
        ],
      };
    }
  );
}
