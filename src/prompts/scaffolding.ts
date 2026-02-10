import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dedent from "dedent";

export function registerScaffoldingPrompts(server: McpServer) {
  server.registerPrompt(
    "createFastEdgeApp",
    {
      title: "Create a FastEdge application",
      description:
        "Interactively create a new FastEdge application with guided template selection",
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: dedent`
                I want to create a new FastEdge application. Please help me choose the right template by asking me about:
                  1. **Programming Language**: Would I prefer JavaScript, TypeScript or Rust?
                  2. **Application Type**: Is this a CDN application (proxy/modify traffic) or HTTP application (API/static site)?
                  3. **Use Case**: What should the application do? Some common patterns:
                    - Basic request/response handling
                    - Request modification (add/modify headers before forwarding)
                    - Response modification (transform responses from origin)
                    - Geo-based routing (route by country)
                    - A/B testing (variant assignment with cookies)
                    - Authentication (JWT validation)
                    - Static website hosting
                    - API gateway (route to multiple upstreams)
                    - React application

                Use: list-fastedge-templates tool to get the list of available templates.

                After gathering my requirements:
                  1. Suggest the best template(s) and ask for confirmation. Particularly if multiple templates are suitable.
                  2. Ask for the folder name to place it in, use './' as the default.
                  3. Use the scaffold-fastedge-project tool to create the appropriate boilerplate code.


                Having created the project, if the "Use Case" provided is not covered completely by the selected template.
                  1. For Javascript / Typescript projects, ensure you run: "npm install" in the correct directory before proceeding.
                  2. Read any README.md files provided in the directory from the scaffold-fastedge-project tool to get a better understanding of the project.
                  3. Check the .claude/skills/ directory in the generated project for FastEdge development patterns and examples.
                  4. This MCP Server provides a /deployFastEdgeApp prompt. It is used to build and deploy FastEdge applications.
                     So no need to provide extensive deployment scripts here.

                Note: For CDN templates, languages javascript / typescript are supported as assemblyscript, a typescript variant.
              `,
            },
          },
        ],
      };
    }
  );

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
