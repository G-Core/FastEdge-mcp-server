import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dedent from "dedent";

/**
 * Smart scaffolding prompt that handles multiple scenarios:
 * 1. New repo (scaffold at root)
 * 2. Existing repo - add new package (scaffold at subfolder)
 * 3. Existing repo - add to existing project (selective file copy)
 *
 * This replaces the old simple createFastEdgeApp prompt with intelligent
 * context detection and language-agnostic scaffolding.
 */
export function registerCreateFastEdgeAppPrompt(server: McpServer) {
  server.registerPrompt(
    "createFastEdgeApp",
    {
      title: "Create FastEdge Application",
      description:
        "Intelligently create a FastEdge application based on repository context - handles new repos, adding packages to existing repos, and mixed-language projects (TypeScript/JavaScript/Rust)",
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: dedent`
                I want to create or add a FastEdge application. Please help me by first understanding my scenario.

                ## Step 1: Detect Repository Context

                Check the current workspace for BOTH JavaScript/TypeScript AND Rust projects:
                1. Check for package.json (JavaScript/TypeScript/AssemblyScript project)
                2. Check for Cargo.toml (Rust project)
                3. Check for existing FastEdge applications (look for /src, /apps, /packages folders)
                4. Check for monorepo structure (multiple languages or multiple packages)

                ## Step 2: Determine Scenario

                Based on what you find, ask me to confirm which scenario applies:

                **Scenario A: Brand New Repository**
                - No package.json AND no Cargo.toml at root
                - Empty or nearly empty workspace (only .vscode/ or .git/)
                - **Action**: Scaffold at root (./) with full structure
                - **Note**: Language choice determines which manifest file is created

                **Scenario B: Add New Package/Application to Existing Repo**
                - Has package.json OR Cargo.toml at root (existing project)
                - OR has monorepo structure (/packages, /apps, /services)
                - User wants a completely separate FastEdge application (possibly different language)
                - **Action**: Scaffold at subfolder (e.g., ./packages/my-app or ./apps/my-app)
                - Ask me for the subfolder path
                - **Examples**:
                  - Rust project at root + add TypeScript app → subfolder
                  - TypeScript at root + add Rust app → subfolder
                  - Monorepo with multiple apps → another subfolder

                **Scenario C: Add to Existing Project**
                - Has package.json OR Cargo.toml at root
                - Has src/ folder with existing code
                - User wants to add FastEdge code to existing project (not create separate package)
                - User's chosen language MUST match existing project language
                - **Action**: Generate in temp location, selectively copy files
                - Ask me which files to include (e.g., just src files, or include config files too)
                - **Warning**: If languages don't match, suggest Scenario B instead

                ## Step 3: Gather Requirements

                Once scenario is confirmed, ask me about:
                1. **Programming Language**: JavaScript, TypeScript, or Rust?
                   - For **Scenario C only**: Check if chosen language matches existing project:
                     - If package.json exists → must choose JavaScript or TypeScript
                     - If Cargo.toml exists → must choose Rust
                     - If mismatch → suggest Scenario B (separate package) instead
                2. **Template Type**: Use list-fastedge-templates tool to show options
                   - Note: Some templates only support certain languages
                   - CDN templates: TypeScript (as AssemblyScript) or Rust
                   - HTTP templates: All languages supported
                3. **Output Location**:
                   - Scenario A: ./ (root)
                   - Scenario B: ./packages/[name] or ./apps/[name] or ./services/[name]
                   - Scenario C: ./tmp-fastedge-scaffold (will copy after)

                ## Step 4: Execute Scaffolding

                **For Scenarios A & B:**
                - Use scaffold-fastedge-project tool with the confirmed outputDir
                - DO NOT run npx commands directly

                **For Scenario C:**
                - Use scaffold-fastedge-project tool with outputDir as ./tmp-fastedge-scaffold
                - After scaffolding completes, ask me which files to copy:
                  - Option 1: Source files only (copy ./tmp-fastedge-scaffold/src/* to ./src/)
                  - Option 2: Source + configs (add build configs, but keep existing package.json)
                  - Option 3: Custom (let me specify which files)
                - Copy the selected files
                - Clean up ./tmp-fastedge-scaffold

                ## Step 5: Post-Scaffold Setup

                After scaffolding:
                1. For TypeScript/JavaScript projects: Ask if I want to run npm/pnpm/yarn install
                2. For Rust projects: Note that cargo build will happen during deployment
                3. Show me the created structure and manifest files:
                   - JavaScript/TypeScript: package.json created
                   - Rust: Cargo.toml and Cargo.lock created
                4. Point me to .claude/skills/ for FastEdge development patterns
                5. Mention the /deployFastEdgeApp prompt for building and deploying
                6. For mixed-language repos: Explain the structure (e.g., Rust at root, TypeScript in ./packages/)

                ## Important Rules

                - ALWAYS use the scaffold-fastedge-project MCP tool (never run npx directly)
                - ALWAYS ask for confirmation before executing
                - ALWAYS explain what will be created and where
                - For Scenario C, ALWAYS use a temp location first and copy selectively
              `,
            },
          },
        ],
      };
    }
  );
}
