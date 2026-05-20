# FastEdge MCP Scaffolding Architecture

## Overview

The FastEdge MCP server now provides intelligent scaffolding that handles multiple repository scenarios through a combination of **prompts**, **tools**, and **resources**.

## Architecture Components

### 1. Tools (Executable Functions)

**`scaffold-fastedge-project`** - The core scaffolding tool
- Creates FastEdge projects from templates
- Parameters:
  - `template`: Template type (http-base, http-react, etc.)
  - `language`: TypeScript, JavaScript, or Rust
  - `outputDir`: Where to create the project
  - `packageManager`: npm, pnpm, or yarn
- Runs `create-fastedge-app` CLI under the hood
- Includes Claude skills in generated projects

### 2. Prompts (Interactive Workflows)

**`/createFastEdgeApp`** - Original simple scaffolding prompt
- Asks basic questions (language, template, location)
- Guides through template selection
- Uses `scaffold-fastedge-project` tool

**`/scaffoldFastEdgeApp`** - NEW: Smart scenario-aware scaffolding
- Detects repository context
- Identifies one of three scenarios:
  - **Scenario A**: Brand new repo → scaffold at root
  - **Scenario B**: Add new package → scaffold at subfolder
  - **Scenario C**: Add to existing → scaffold to temp, copy selectively
- Asks clarifying questions
- Guides through appropriate workflow
- Uses `scaffold-fastedge-project` tool appropriately for each scenario

### 3. Resources (Documentation & Guidance)

**`fastedge://guides/scaffolding`** - Scaffolding decision tree and best practices
- Detailed explanation of all three scenarios
- Decision tree for choosing the right approach
- Examples with before/after directory structures
- Best practices and troubleshooting

**`fastedge://guides/templates`** - Template selection guide
- Overview of available templates
- Decision matrix for choosing templates
- Questions to ask users

## How They Work Together

```
User invokes prompt
       ↓
Prompt asks questions + reads resources for context
       ↓
Agent makes decisions based on:
  - User answers
  - Repository context (package.json exists?)
  - Resource guidance (decision tree)
       ↓
Prompt instructs to use tool
       ↓
Tool executes scaffolding
       ↓
Prompt provides post-scaffold guidance
```

## Three Scenarios Explained

### Scenario A: Brand New Repository

**When**: Empty workspace or only .vscode/ folder

**Flow**:
```
1. Detect: No package.json at root
2. Confirm: "This looks like a new repo. Scaffold at root?"
3. Ask: Language, template, package manager
4. Execute: scaffold-fastedge-project with outputDir="./"
5. Result: Full project structure at root
```

**Example**:
```bash
# Before
workspace/
  └── .vscode/

# Command
scaffold-fastedge-project --template http-react-hono --typescript --outputDir ./

# After
workspace/
  ├── package.json
  ├── src/
  ├── .claude/skills/
  └── README.md
```

### Scenario B: Add New Package

**When**: Existing repo, want separate package

**Flow**:
```
1. Detect: package.json exists OR monorepo structure
2. Confirm: "Add as separate package in subfolder?"
3. Ask:
   - Which subfolder? (./packages/, ./apps/, ./services/)
   - Package name?
   - Language, template
4. Execute: scaffold-fastedge-project with outputDir="./packages/my-app"
5. Result: New independent package in subfolder
```

**Example**:
```bash
# Before
workspace/
  ├── package.json
  └── packages/
      └── existing-app/

# Command
scaffold-fastedge-project --template http-base --typescript --outputDir ./packages/new-app

# After
workspace/
  ├── package.json (unchanged)
  └── packages/
      ├── existing-app/
      └── new-app/          # New package
          ├── package.json
          └── src/
```

### Scenario C: Add to Existing Project

**When**: Existing project, want to add FastEdge files (not new package)

**Flow**:
```
1. Detect: package.json AND src/ exist
2. Confirm: "Add FastEdge code to existing project?"
3. Ask: Which files to include?
   - Option 1: Source files only
   - Option 2: Source + configs
   - Option 3: Custom selection
4. Execute TWO STEPS:
   a. scaffold-fastedge-project with outputDir="./tmp-fastedge-scaffold"
   b. Copy selected files to destination
   c. Clean up temp directory
5. Result: FastEdge files merged into existing project
```

**Example**:
```bash
# Before
workspace/
  ├── package.json
  └── src/
      └── my-code.ts

# Step 1: Scaffold to temp
scaffold-fastedge-project --template http-base --typescript --outputDir ./tmp-fastedge-scaffold

# Step 2: Copy source files only
cp -r ./tmp-fastedge-scaffold/src/* ./src/

# Step 3: Cleanup
rm -rf ./tmp-fastedge-scaffold

# After
workspace/
  ├── package.json (unchanged)
  └── src/
      ├── my-code.ts (original)
      └── index.ts   (from template)
```

## Why This Architecture?

### Problem
Users have different needs based on repository context:
- New projects need full structure at root
- Monorepos need separate packages
- Existing projects need selective file addition

### Solution: Mixture of Components

1. **Tools provide capabilities**
   - `scaffold-fastedge-project` can create projects anywhere
   - Flexible `outputDir` parameter

2. **Prompts provide intelligence**
   - Detect repository context
   - Ask clarifying questions
   - Guide through appropriate workflow
   - Use tools correctly for each scenario

3. **Resources provide knowledge**
   - Decision trees for agents
   - Best practices and examples
   - Troubleshooting guides
   - Act like "skills" but server-provided

## Usage Examples

### Example 1: New User, Empty Repo

**User invokes**: `/scaffoldFastEdgeApp`

**Agent flow**:
```
1. Reads resource: fastedge://guides/scaffolding
2. Checks workspace: No package.json found
3. Asks: "This looks like a new repository. Scaffold at root?"
4. User confirms
5. Asks: "TypeScript, JavaScript, or Rust?"
6. User: "TypeScript"
7. Uses list-fastedge-templates tool
8. Asks: "Which template? http-base, http-react, or http-react-hono?"
9. User: "http-react-hono"
10. Uses scaffold-fastedge-project tool:
    - template: http-react-hono
    - language: typescript
    - outputDir: "./"
11. Shows result and next steps
```

### Example 2: Monorepo, Add New Service

**User invokes**: `/scaffoldFastEdgeApp`

**Agent flow**:
```
1. Reads resource: fastedge://guides/scaffolding
2. Checks workspace: Found package.json and packages/ folder
3. Asks: "This is a monorepo. Add as new package?"
4. User confirms
5. Asks: "Where should the new package go? (e.g., ./packages/my-service)"
6. User: "./packages/edge-api"
7. Continues with template/language selection
8. Uses scaffold-fastedge-project tool:
    - outputDir: "./packages/edge-api"
9. Shows result
```

### Example 3: Existing Project, Add FastEdge

**User invokes**: `/scaffoldFastEdgeApp`

**Agent flow**:
```
1. Reads resource: fastedge://guides/scaffolding
2. Checks workspace: Found package.json and src/ folder
3. Asks: "Add FastEdge code to existing project (not as separate package)?"
4. User confirms
5. Asks: "Which files to include?
   1. Source files only
   2. Source + build configs
   3. Custom"
6. User: "Source files only"
7. Uses scaffold-fastedge-project tool:
    - outputDir: "./tmp-fastedge-scaffold"
8. Copies src/* to ./src/
9. Cleans up ./tmp-fastedge-scaffold
10. Shows merged files
```

## Benefits

### For Users
- ✅ Intelligent behavior based on context
- ✅ Doesn't overwrite existing work
- ✅ Handles monorepos correctly
- ✅ Flexible for different workflows
- ✅ Guided with questions and confirmations

### For Agents
- ✅ Clear decision tree (resources)
- ✅ Step-by-step instructions (prompts)
- ✅ Flexible tool (scaffold-fastedge-project)
- ✅ No ambiguity about what to do
- ✅ Resources act like "built-in knowledge"

### For Maintainers
- ✅ One tool, multiple scenarios
- ✅ Logic in prompts (easy to update)
- ✅ Documentation in resources (discoverability)
- ✅ Clean separation of concerns

## How to Use

### As a User

**Simple scaffolding**:
```
/createFastEdgeApp
```

**Smart scenario-aware scaffolding**:
```
/scaffoldFastEdgeApp
```

### As an Agent

**Check context first**:
```
1. Read fastedge://guides/scaffolding resource
2. Check for package.json, src/, packages/ folders
3. Determine scenario
4. Ask user to confirm
5. Use scaffold-fastedge-project tool appropriately
```

**Read resources for guidance**:
- Agent can read `fastedge://guides/scaffolding` for decision tree
- Agent can read `fastedge://guides/templates` for template selection

## Future Enhancements

### Potential Additions

1. **Resource for monorepo patterns**
   - How to structure monorepos
   - Shared dependencies
   - Workspace configurations

2. **Prompt for migration**
   - `/migrateFastEdgeApp` - Migrate existing code to FastEdge

3. **Tool for file merging**
   - Smart merge of conflicting files
   - Diff preview before copying

4. **Resource for best practices**
   - Project structure recommendations
   - Naming conventions
   - Configuration patterns

---

**Last Updated**: February 11, 2026
