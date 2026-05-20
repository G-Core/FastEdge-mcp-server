import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dedent from "dedent";

/**
 * Register scaffolding guidance resources
 * These act like documentation/skills that agents can read for context
 */
export function registerScaffoldingResources(server: McpServer) {
  // Resource: Scaffolding decision tree
  server.registerResource(
    "fastedge-scaffolding-guide",
    "fastedge://guides/scaffolding",
    {
      mimeType: "text/markdown",
      description:
        "Guide for scaffolding FastEdge applications in different repository contexts",
    },
    async () => {
      return {
        contents: [
          {
            uri: "fastedge://guides/scaffolding",
            mimeType: "text/markdown",
            text: dedent`
              # FastEdge Application Scaffolding Guide

              This guide helps you understand when and how to scaffold FastEdge applications in different repository contexts.

              ## Quick Decision Tree

              \`\`\`
              Is there a package.json OR Cargo.toml at root?
              │
              ├─ NO → Scenario A: New Repository
              │        Action: Scaffold at root (./)
              │        Note: Creates package.json (TS/JS) or Cargo.toml (Rust)
              │
              └─ YES → Does the user want a separate package/application?
                       │
                       ├─ YES → Scenario B: New Package
                       │        Action: Scaffold at ./packages/[name] or ./apps/[name]
                       │        Note: Can be different language than root
                       │
                       └─ NO → Scenario C: Add to Existing Project
                                Action: Scaffold to temp, copy selectively
                                Note: MUST match existing project language
                                      (TS to TS, Rust to Rust)
              \`\`\`

              ## Language Considerations

              **JavaScript/TypeScript/AssemblyScript Projects:**
              - Manifest file: package.json
              - Source directory: src/
              - Build output: node_modules/, dist/, build/
              - Dependencies: npm, pnpm, or yarn
              - Build: npm run build

              **Rust Projects:**
              - Manifest file: Cargo.toml
              - Source directory: src/
              - Build output: target/
              - Dependencies: Cargo
              - Build: cargo build --release --target wasm32-wasip1

              **Mixed-Language Repositories:**
              - Can have both package.json AND Cargo.toml in different folders
              - Common structure: Root is one language, subfolders are other languages
              - Example: Rust at root, TypeScript apps in ./packages/
              - Use Scenario B to add different language applications

              ## Scenario A: Brand New Repository

              **Context:**
              - Workspace is empty or only contains .vscode/ or .git/
              - No package.json AND no Cargo.toml at root
              - First FastEdge application in this repo

              **Action:**
              \`\`\`
              Use: scaffold-fastedge-project
              Parameters:
                - template: [chosen template]
                - language: [typescript/javascript/rust]
                - outputDir: "./"
              \`\`\`

              **Result:**
              - Full project structure at root
              - **TypeScript/JavaScript**: package.json, node_modules/, src/
              - **Rust**: Cargo.toml, Cargo.lock, src/
              - .claude/skills/ with development guidance
              - README.md with instructions

              **Example (TypeScript):**
              \`\`\`
              Before:
              workspace/
                └── .vscode/
                    └── mcp.json

              After:
              workspace/
                ├── .vscode/
                ├── package.json
                ├── src/
                │   └── index.ts
                ├── .claude/
                │   └── skills/
                └── README.md
              \`\`\`

              **Example (Rust):**
              \`\`\`
              Before:
              workspace/
                └── .vscode/
                    └── mcp.json

              After:
              workspace/
                ├── .vscode/
                ├── Cargo.toml
                ├── Cargo.lock
                ├── src/
                │   └── lib.rs
                ├── .claude/
                │   └── skills/
                └── README.md
              \`\`\`

              ---

              ## Scenario B: Add New Package to Existing Repo

              **Context:**
              - Existing package.json OR Cargo.toml at root OR monorepo structure
              - User wants a completely separate FastEdge application
              - New application can be SAME or DIFFERENT language than existing code
              - May be building a monorepo with multiple packages/services

              **Action:**
              \`\`\`
              Use: scaffold-fastedge-project
              Parameters:
                - template: [chosen template]
                - language: [typescript/javascript/rust] (can differ from root)
                - outputDir: "./packages/my-app" (or "./apps/my-app")
              \`\`\`

              **Questions to Ask:**
              1. What folder should this package go in?
                 - Common patterns: ./packages/, ./apps/, ./services/
              2. What should we name this package?
              3. What language? (Can be different from existing projects)
              4. Should this share dependencies with root (if monorepo)?

              **Result:**
              - New package at specified subfolder
              - Own manifest file (package.json OR Cargo.toml)
              - Own /src folder with entry point
              - Own .claude/skills/
              - Can be run and deployed independently

              **Example 1: Same Language (TypeScript monorepo):**
              \`\`\`
              Before:
              workspace/
                ├── package.json          # Root package
                └── packages/
                    └── existing-app/
                        └── package.json

              After:
              workspace/
                ├── package.json
                └── packages/
                    ├── existing-app/
                    │   └── package.json
                    └── my-new-app/       # New TypeScript FastEdge app
                        ├── package.json
                        ├── src/
                        └── .claude/
              \`\`\`

              **Example 2: Mixed Languages (Rust root + TypeScript app):**
              \`\`\`
              Before:
              workspace/
                ├── Cargo.toml           # Rust project at root
                └── src/
                    └── lib.rs

              After:
              workspace/
                ├── Cargo.toml           # Root Rust project (unchanged)
                ├── src/
                │   └── lib.rs
                └── packages/
                    └── ts-api/          # New TypeScript FastEdge app
                        ├── package.json
                        └── src/
                            └── index.ts
              \`\`\`

              **Example 3: Mixed Languages (TypeScript root + Rust service):**
              \`\`\`
              Before:
              workspace/
                ├── package.json         # TypeScript project at root
                └── src/
                    └── index.ts

              After:
              workspace/
                ├── package.json         # Root TypeScript project (unchanged)
                ├── src/
                │   └── index.ts
                └── services/
                    └── rust-cdn/        # New Rust FastEdge app
                        ├── Cargo.toml
                        └── src/
                            └── lib.rs
              \`\`\`

              ---

              ## Scenario C: Add to Existing Project

              **Context:**
              - Existing package.json OR Cargo.toml and src/ folder
              - User wants FastEdge code in existing project
              - NOT creating a separate package
              - **CRITICAL**: Chosen language MUST match existing project language

              **Language Validation:**
              - If package.json exists → User MUST choose TypeScript or JavaScript
              - If Cargo.toml exists → User MUST choose Rust
              - If mismatch detected → Suggest Scenario B (separate package) instead

              **Action (Two-Step Process):**

              **Step 1: Generate in Temp Location**
              \`\`\`
              Use: scaffold-fastedge-project
              Parameters:
                - template: [chosen template]
                - language: [MUST match existing: ts/js for package.json, rust for Cargo.toml]
                - outputDir: "./tmp-fastedge-scaffold"
              \`\`\`

              **Step 2: Selective Copy**
              Ask user which files to include:

              **Option 1: Source Files Only**
              - Copy ./tmp-fastedge-scaffold/src/* → ./src/
              - Merge with existing source code
              - User must manually integrate imports/exports
              - Do NOT copy manifest files

              **Option 2: Source + Build Configs**
              - Copy source files
              - Copy build configs (tsconfig.json for TS, or Cargo.toml sections for Rust)
              - Keep existing manifest file (do NOT overwrite)
              - May need to merge configuration manually

              **Option 3: Custom Selection**
              - Let user specify which files to copy
              - Common: src/, types/, configs
              - Never copy: package.json, Cargo.toml, node_modules/, target/

              **Step 3: Cleanup**
              \`\`\`bash
              rm -rf ./tmp-fastedge-scaffold
              \`\`\`

              **Example 1: TypeScript Project**
              \`\`\`
              Before:
              workspace/
                ├── package.json
                └── src/
                    └── my-code.ts

              After Temp Scaffold:
              workspace/
                ├── package.json
                ├── src/
                │   └── my-code.ts
                └── tmp-fastedge-scaffold/
                    ├── package.json      # Will NOT copy this
                    ├── src/
                    │   └── index.ts      # WILL copy this
                    └── .claude/

              After Selective Copy:
              workspace/
                ├── package.json          # Unchanged
                └── src/
                    ├── my-code.ts        # Original
                    └── index.ts          # Copied from template
              \`\`\`

              **Example 2: Rust Project**
              \`\`\`
              Before:
              workspace/
                ├── Cargo.toml
                └── src/
                    └── lib.rs

              After Temp Scaffold:
              workspace/
                ├── Cargo.toml
                ├── src/
                │   └── lib.rs
                └── tmp-fastedge-scaffold/
                    ├── Cargo.toml        # Will NOT copy this (or merge sections)
                    ├── src/
                    │   └── lib.rs        # WILL copy functions from this
                    └── .claude/

              After Selective Copy:
              workspace/
                ├── Cargo.toml            # Unchanged (may need manual dependency merge)
                └── src/
                    └── lib.rs            # Merged: original + template functions
              \`\`\`

              **Warning: Language Mismatch**
              \`\`\`
              If user wants to add Rust to TypeScript project (or vice versa):
              → This is NOT Scenario C
              → Suggest Scenario B (create separate package in subfolder)
              → Example: TypeScript at root, Rust in ./services/rust-app/
              \`\`\`

              ---

              ## Best Practices

              ### Always Ask First
              - Detect the scenario
              - Explain what will happen
              - Get user confirmation

              ### Use the MCP Tool
              - ALWAYS use scaffold-fastedge-project tool
              - NEVER run npx commands directly
              - The tool handles dependencies, setup, and skills

              ### Be Careful with Existing Files
              - In Scenario C, never overwrite package.json
              - Warn about file conflicts
              - Offer to show diffs before copying

              ### Post-Scaffold Steps
              1. Show what was created
              2. Point to .claude/skills/ for guidance
              3. Suggest running npm install (if needed)
              4. Mention /deployFastEdgeApp for deployment

              ---

              ## Common Patterns by Project Type

              ### JavaScript/TypeScript Monorepo (Lerna, Nx, Turborepo)
              → Use Scenario B
              → Create at ./packages/[name] or ./apps/[name]
              → All packages share root package.json workspace config

              ### Rust Workspace
              → Use Scenario B
              → Create at ./packages/[name] or ./crates/[name]
              → All packages share root Cargo.toml workspace config

              ### Single Package Repo
              → Use Scenario A (if empty) or Scenario C (if has code)
              → TypeScript: Creates package.json at root
              → Rust: Creates Cargo.toml at root

              ### Microservices Architecture (Mixed Languages)
              → Use Scenario B for each service
              → Create at ./services/[name]
              → Can mix languages freely:
                - ./services/api/ (TypeScript)
                - ./services/cdn/ (Rust)
                - ./services/auth/ (TypeScript)

              ### Learning/Examples Repo
              → Use Scenario B
              → Create at ./examples/[name]
              → Great for demonstrating multiple languages:
                - ./examples/http-ts/
                - ./examples/http-rust/
                - ./examples/cdn-rust/

              ### Polyglot Repository (Multiple Languages)
              → Use Scenario B for each language
              → Common structure:
                - Cargo.toml at root (Rust primary)
                - ./packages/ts-api/ (TypeScript apps)
                - ./services/rust-cdn/ (Rust services)

              ---

              ## Troubleshooting

              **Q: User has package.json but wants to scaffold at root**
              A: This is unusual. Ask if they want to:
              - Replace the existing project (Scenario A with warning)
              - Add FastEdge to existing project (Scenario C)

              **Q: User has Cargo.toml but wants to scaffold at root**
              A: Same as above - confirm if replacing or adding to existing

              **Q: User has BOTH package.json and Cargo.toml**
              A: This is likely a polyglot repo (Scenario B already used)
              - Ask which language they want to add
              - Use Scenario B to add in appropriate subfolder
              - Structure: root manifest for primary language, subfolders for others

              **Q: User wants multiple templates in one project**
              A: Use Scenario B multiple times, each in different subfolder

              **Q: Language mismatch - Scenario C with wrong language**
              Examples:
              - Existing TypeScript project, user wants Rust template
              - Existing Rust project, user wants TypeScript template

              A: This is NOT Scenario C!
              - Explain: Scenario C requires matching languages
              - Suggest: Use Scenario B (separate package in subfolder)
              - Example: Keep TypeScript at root, add Rust at ./services/rust-app/

              **Q: User wants to add TypeScript to Rust project (or vice versa)**
              A: Use Scenario B
              - Scaffold in subfolder: ./packages/[name]/ or ./services/[name]/
              - Each language has its own manifest and dependencies
              - Both can be deployed independently

              **Q: User unsure which scenario**
              A: Use the decision tree above and ask clarifying questions:
              1. What manifest files exist? (package.json? Cargo.toml?)
              2. Do you want this separate or merged with existing code?
              3. Is the language the same as existing code?

              **Q: Can I have a Rust CDN app and TypeScript HTTP app in same repo?**
              A: Yes! Use Scenario B twice:
              1. First app at root (Scenario A): Rust CDN with Cargo.toml
              2. Second app at ./packages/http-api/ (Scenario B): TypeScript HTTP with package.json
            `,
          },
        ],
      };
    }
  );

  // Resource: Template selection guide
  server.registerResource(
    "fastedge-template-guide",
    "fastedge://guides/templates",
    {
      mimeType: "text/markdown",
      description: "Guide for choosing the right FastEdge template",
    },
    async () => {
      return {
        contents: [
          {
            uri: "fastedge://guides/templates",
            mimeType: "text/markdown",
            text: dedent`
              # FastEdge Template Selection Guide

              ## Available Templates

              Use \`list-fastedge-templates\` tool to get the current list.

              ## Common Templates

              ### http-base
              - **Use Case**: Simple HTTP applications, APIs
              - **Languages**: TypeScript, JavaScript, Rust
              - **Best For**: REST APIs, simple request/response handling

              ### http-react
              - **Use Case**: React applications with FastEdge
              - **Languages**: TypeScript, JavaScript
              - **Best For**: Single-page applications, interactive UIs

              ### http-react-hono
              - **Use Case**: React + Hono (lightweight server framework)
              - **Languages**: TypeScript, JavaScript
              - **Best For**: Full-stack React apps with API routes

              ### cdn-base
              - **Use Case**: CDN/Edge proxy applications
              - **Languages**: TypeScript, JavaScript (AssemblyScript), Rust
              - **Best For**: Traffic modification, request/response proxying

              ## Decision Matrix

              | User Wants | Template | Language |
              |------------|----------|----------|
              | REST API | http-base | TypeScript |
              | React SPA | http-react | TypeScript |
              | Full-stack React | http-react-hono | TypeScript |
              | CDN Proxy | cdn-base | TypeScript or Rust |
              | Performance Critical | http-base or cdn-base | Rust |

              ## Questions to Ask

              1. What type of application? (API, website, proxy)
              2. Need React? (→ http-react or http-react-hono)
              3. Need server-side rendering? (→ http-react-hono)
              4. Performance critical? (→ Consider Rust)
            `,
          },
        ],
      };
    }
  );
}
