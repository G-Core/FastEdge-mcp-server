import dedent from "dedent";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ToolOptions } from "../index.js";
import { availableFastEdgeTemplates } from "./index.js";
import { normalizePath, INVALID_PATH } from "../../utils/index.js";

import type { Language, ScaffoldTemplateType } from "./types.js";

const execAsync = promisify(exec);

export function registerListAvailableTemplates(
  server: McpServer,
  options: ToolOptions
) {
  // Tool to list available templates
  server.tool(
    "list-fastedge-templates",
    "List all available FastEdge templates with descriptions, languages, and application types. Fetches the latest template list from create-fastedge-app.",
    {},
    {
      title: "List FastEdge Templates",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true, // Changed to true since we're calling external command
    },
    async () => {
      try {
        // Fetch templates from create-fastedge-app CLI
        const { stdout } = await execAsync("npx create-fastedge-app --list-templates");
        const templates = JSON.parse(stdout) as Array<{
          name: string;
          description: string;
          languages: string[];
          applicationType: string;
        }>;

        const templateList = templates
          .map(
            (t) =>
              `- **${t.name}**: ${t.description}\n  Languages: ${t.languages.join(", ")} | Type: ${t.applicationType}`
          )
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `Available FastEdge Templates:\n\n${templateList}\n\nNote: All templates include .claude/skills/ directory with:\n- fastedge-development: Core development patterns\n- fastedge-debugging: Local testing with debugger\n- fastedge-deployment: Production deployment\n- fastedge-examples: Example applications`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch templates from create-fastedge-app: ${error instanceof Error ? error.message : String(error)}\n\nMake sure create-fastedge-app is available via npx.`,
            },
          ],
        };
      }
    }
  );
}

export function registerCreateBoilerPlateCode(
  server: McpServer,
  options: ToolOptions
) {
  // Tool to scaffold a new FastEdge project
  server.tool(
    "scaffold-fastedge-project",
    "Create a new FastEdge project with boilerplate code. Choose from templates for different use cases.",
    {
      template: z
        .enum(availableFastEdgeTemplates)
        .describe("The type of FastEdge project template to use"),
      language: z
        .enum(["assemblyscript", "javascript", "typescript", "rust"])
        .describe("The programming language to use"),
      outputDir: z
        .string()
        .describe("Relative path where the project should be created"),
    },
    {
      title: "Scaffold FastEdge Project",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async (params: {
      template: ScaffoldTemplateType;
      language: Language;
      outputDir: string;
    }) => {
      try {
        // Validate template type
        const templateType = availableFastEdgeTemplates.find(
          (t) => t === params.template
        );

        if (!templateType) {
          throw new Error(`Invalid template: ${params.template}`);
        }

        // Validate output directory
        const outputPath = normalizePath(
          options.workspaceRoot,
          params.outputDir
        );
        if (outputPath === INVALID_PATH) {
          throw new Error(
            "Invalid output directory: Must be relative to workspace"
          );
        }

        // Use npx to run create-fastedge-app CLI
        const command = `npx create-fastedge-app "${outputPath}" --template ${params.template} --language ${params.language} --skip-prompts`;

        // Execute the CLI command
        const { stdout, stderr } = await execAsync(command, {
          cwd: options.workspaceRoot,
          env: process.env,
        });

        // Determine application type and next steps
        const applicationType = params.template.startsWith("cdn") ? "cdn" : "http";

        const textResponse = dedent`
          Successfully created ${params.template} FastEdge project at ${params.outputDir}.

          Template: ${params.template}
          Language: ${params.language}
          Type: ${applicationType}

          The project includes:
            - Source code in the selected language
            - Build configuration files
            - .claude/skills/ directory with:
              * fastedge-development: Core development patterns
              * fastedge-debugging: Local testing guidance
              * fastedge-deployment: Production deployment workflows
              * fastedge-examples: Links to example applications

          Next steps:
            1. cd ${params.outputDir}
            ${
              params.language === "rust"
                ? dedent`
                  2. cargo build --release --target wasm32-wasip1
                  3. Test locally with fastedge-debugger (recommended)
                  4. Deploy to FastEdge using build-wasm and upload-binary tools
                `
                : dedent`
                  2. npm install
                  3. npm run build
                  4. Test locally with fastedge-debugger (recommended)
                  5. Deploy to FastEdge using build-wasm and upload-binary tools
              `
            }

          💡 Tip: Always test locally with fastedge-debugger before deploying to production.
          See the fastedge-debugging skill for testing guidance.
        `;

        return {
          content: [
            {
              type: "text",
              text: textResponse,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to scaffold FastEdge project: ${
                error?.message || String(error)
              }\n\nMake sure create-fastedge-app is available. You may need to run: npm install -g create-fastedge-app`,
            },
          ],
        };
      }
    }
  );
}
