import dedent from "dedent";
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ToolOptions } from "../index.js";
import { FastEdgeTemplates } from "./resources.js";
import { availableFastEdgeTemplates } from "./index.js";
import { normalizePath, INVALID_PATH } from "../../utils/index.js";

import type { Language, ScaffoldTemplateType } from "./types.js";

export function registerListAvailableTemplates(
  server: McpServer,
  options: ToolOptions
) {
  // Tool to list available templates
  server.tool(
    "list-fastedge-templates",
    "List all available FastEdge templates with descriptions, languages, and application types",
    {},
    {
      title: "List FastEdge Templates",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async () => {
      const templates = Object.entries(FastEdgeTemplates).map(
        ([key, value]) => ({
          name: key,
          description: value[0]?.description,
          languages: value.map((scaffold) => scaffold.language).join(", "),
          applicationType: (value as any).applicationType || "http",
        })
      );

      const templateList = templates
        .map(
          (t) =>
            `- **${t.name}**: ${t.description}\n  Languages: ${t.languages} | Type: ${t.applicationType}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Available FastEdge Templates: \n ${templateList}`,
          },
        ],
      };
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
        let template = undefined;

        const templateType = availableFastEdgeTemplates.find(
          (t) => t === params.template
        );

        if (!templateType) {
          throw new Error("Invalid template/language selected");
        }

        template = FastEdgeTemplates[templateType].find(
          (t) => t.language === params.language
        );

        if (!template) {
          throw new Error("Invalid template/language selected");
        }

        // Create output directory
        const outputPath = normalizePath(
          options.workspaceRoot,
          params.outputDir
        );
        if (outputPath === INVALID_PATH) {
          throw new Error(
            "Invalid output directory: Must be relative to workspace"
          );
        }
        await fs.mkdir(outputPath, { recursive: true });

        // Create project files with proper directory structure
        const fileEntries = Object.entries(template.files);
        for (const [fileName, content] of fileEntries) {
          const filePath = path.join(outputPath, fileName);
          const fileDir = path.dirname(filePath);

          // Create directory if it doesn't exist
          await fs.mkdir(fileDir, { recursive: true });

          // Write file
          await fs.writeFile(filePath, content as string);
        }

        const language = (template as any).language || "javascript";

        const textResponse = dedent`
          Successfully created ${params.template} FastEdge project at ${
          params.outputDir
        }.

          Template: ${template.description}
          Language: ${language}
          Type: ${(template as any).applicationType || "http"}

          Project contains the following files:
            ${fileEntries.map(([name]) => `- ${name}`).join("\n")}

          Next steps:
            1. cd ${params.outputDir}
            ${
              language === "rust"
                ? dedent`
                  2. cargo build --release
                  3. Deploy the generated ./target/wasm32-wasip1/release/${params.template}.wasm to FastEdge
                `
                : dedent`
                  2. npm install
                  3. npm run build
                  4. Deploy the generated ./wasm/${params.template}.wasm to FastEdge
              `
            }`;

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
              }`,
            },
          ],
        };
      }
    }
  );
}
