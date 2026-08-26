import dedent from "dedent";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ToolOptions } from "../../index.js";
import { availableFastEdgeTemplates } from "./index.js";
import { normalizePath, INVALID_PATH } from "../../../utils/index.js";

import type { Language, ScaffoldTemplateType } from "./types.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export function registerListAvailableTemplates(
  server: McpServer,
  options: ToolOptions,
) {
  // Tool to list available templates
  server.registerTool(
    "list-fastedge-templates",
    {
      title: "List FastEdge Templates",
      description: "List all available FastEdge templates with descriptions, languages, and application types. Fetches the latest template list from create-fastedge-app.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true, // Changed to true since we're calling external command
      },
    },
    async () => {
      const startTime = Date.now();
      try {
        // Fetch templates from create-fastedge-app CLI
        // Use --yes to skip npx prompts, and set a timeout
        const command = "npx --yes create-fastedge-app@beta --list-templates";
        const { stdout, stderr } = await execAsync(command, {
          timeout: 30000, // 30 second timeout
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        if (stderr) {
          console.error(`[list-fastedge-templates] stderr: ${stderr}`);
        }

        const templates = JSON.parse(stdout) as Array<{
          name: string;
          description: string;
          languages: string[];
          applicationType: string;
        }>;

        const templateList = templates
          .map(
            (t) =>
              `- **${t.name}**: ${t.description}\n  Languages: ${t.languages.join(", ")} | Type: ${t.applicationType}`,
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
        const elapsed = Date.now() - startTime;
        console.error(
          `[list-fastedge-templates] Error after ${elapsed}ms:`,
          error,
        );

        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch templates from create-fastedge-app after ${elapsed}ms: ${error instanceof Error ? error.message : String(error)}\n\nMake sure create-fastedge-app is available via npx.\n\nTry running manually: npx --yes create-fastedge-app --list-templates`,
            },
          ],
        };
      }
    },
  );
}

export function registerCreateBoilerPlateCode(
  server: McpServer,
  options: ToolOptions,
) {
  // Tool to scaffold a new FastEdge project
  server.registerTool(
    "scaffold-fastedge-project",
    {
      title: "Scaffold FastEdge Project",
      description: "Create a new FastEdge project with boilerplate code using create-fastedge-app. This is the primary tool for creating FastEdge applications - use this instead of running npx commands directly. Choose from templates for different use cases (http-base, http-react, http-react-hono, cdn-base). Automatically installs dependencies and includes Claude skills for development guidance.",
      inputSchema: {
        template: z
          .enum(availableFastEdgeTemplates)
          .describe("The type of FastEdge project template to use"),
        language: z
          .enum(["assemblyscript", "javascript", "typescript", "rust"])
          .describe("The programming language to use"),
        outputDir: z
          .string()
          .describe("Relative path where the project should be created"),
        packageManager: z
          .enum(["npm", "pnpm", "yarn"])
          .optional()
          .describe("Package manager to use (default: npm)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params: {
      template: ScaffoldTemplateType;
      language: Language;
      outputDir: string;
      packageManager?: "npm" | "pnpm" | "yarn";
    }) => {
      const startTime = Date.now();
      try {
        // Validate template type
        const templateType = availableFastEdgeTemplates.find(
          (t) => t === params.template,
        );

        if (!templateType) {
          throw new Error(`Invalid template: ${params.template}`);
        }

        // Validate output directory
        const outputPath = normalizePath(
          options.workspaceRoot,
          params.outputDir,
        );
        if (outputPath === INVALID_PATH) {
          throw new Error(
            "Invalid output directory: Must be relative to workspace",
          );
        }

        // Build command with proper flags to avoid interactive prompts:
        // - npx --yes: Skip install confirmation
        // - --no-verify: Skip "Do you want to continue?" confirmation (validate-config.ts:211)
        // - --{language}: Specify language flag (--javascript, --typescript, etc.)
        // - --pnpm or --yarn: Use alternative package manager (optional)
        const args = [
          "--yes",
          "create-fastedge-app@beta",
          outputPath,
          "--template",
          params.template,
          `--${params.language}`,
          "--no-verify",
          ...(params.packageManager && params.packageManager !== "npm"
            ? [`--${params.packageManager}`]
            : []),
        ];

        // Execute via execFile with an args array instead of a shell command string,
        // so outputPath can never be interpreted as shell syntax. No shell on any
        // platform: this server only ships as a Linux Docker image (see
        // DEVELOPMENT.md) — native Windows execution isn't a supported path.
        const { stderr } = await execFileAsync("npx", args, {
          cwd: options.workspaceRoot,
          env: process.env,
          timeout: 120000, // 2 minute timeout for scaffolding + npm install
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });

        const elapsed = Date.now() - startTime;

        if (stderr) {
          console.error(
            `[scaffold-fastedge-project] stderr: ${stderr.substring(0, 500)}`,
          );
        }

        // Determine application type and next steps
        const applicationType = params.template.startsWith("cdn")
          ? "cdn"
          : "http";

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
        const elapsed = Date.now() - startTime;
        console.error(
          `[scaffold-fastedge-project] Error after ${elapsed}ms:`,
          error,
        );

        return {
          content: [
            {
              type: "text",
              text: `Failed to scaffold FastEdge project after ${elapsed}ms: ${
                error?.message || String(error)
              }\n\nMake sure create-fastedge-app is available via npx.\n\nDebug: Try running manually:\nnpx --yes create-fastedge-app@beta ./test-dir --template ${params.template} --${params.language} --no-verify`,
            },
          ],
        };
      }
    },
  );
}
