# FastEdge MCP Server - Changelog

**IMPORTANT**: Do not read this file linearly. Use grep to search for keywords.

**Example searches**:
```bash
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool" context/CHANGELOG.md
grep -i "fix.*api" context/CHANGELOG.md
grep "## \[2026-" context/CHANGELOG.md
```

See `SEARCH_GUIDE.md` for more search patterns.

---

## [2026-02-10] - Dynamic Template List from create-fastedge-app

### Overview
Removed hard-coded template list from MCP server. The `list-fastedge-templates` tool now fetches the latest template information dynamically from `create-fastedge-app --list-templates`.

### What Was Completed

**create-fastedge-app enhancements**:
- Added `--list-templates` flag to output template metadata as JSON
- Returns: template name, description, supported languages, application type
- Updated help text to document the new flag
- Alias: `-l` for `--list-templates`

**MCP Server updates**:
- `list-fastedge-templates` tool now calls `npx create-fastedge-app --list-templates`
- Parses JSON output and formats for display
- Removes hard-coded template descriptions and language lists
- Static validation array kept for Zod schema (safety check)

**Files Modified**:
- `create-fastedge-app/src/create-app/index.ts` - Added --list-templates handler
- `create-fastedge-app/src/create-app/types.ts` - Added ParsedArgs property
- `create-fastedge-app/src/create-app/print-info.ts` - Updated help text
- `FastEdge-mcp-server/src/tools/scaffolding/scaffolds.ts` - Dynamic template fetching
- `FastEdge-mcp-server/src/tools/scaffolding/index.ts` - Added clarifying comment

### Benefits
- **Single source of truth**: Templates defined only in create-fastedge-app
- **Always up-to-date**: MCP server shows latest templates without code changes
- **No sync issues**: Add/remove templates in one place
- **Machine-readable**: JSON output enables programmatic usage

### Usage

**create-fastedge-app**:
```bash
npx create-fastedge-app --list-templates
# Returns JSON array of templates
```

**MCP Server**:
```
list-fastedge-templates  # Fetches from create-fastedge-app
```

### Example Output
```json
[
  {
    "name": "http-base",
    "description": "Simple request/response handling application",
    "languages": ["javascript", "typescript", "rust", "assemblyscript"],
    "applicationType": "http"
  },
  ...
]
```

---

## [2026-02-10] - Complete Removal of Documentation Generation System

### Overview
Completed the refactoring by fully removing the create-docs script and all resource generation logic. The MCP server is now purely focused on build and deployment tools, with documentation provided via skills in generated projects.

### What Was Completed

**Files Removed**:
- `assets/scripts/create-docs.ts` - Documentation generation script
- `src/resources/` - Entire directory (fastedge-core, fastedge-examples, fastedge-sdk-js, dotenv)
- `src/tools/context/` - get-fastedge-context tool
- `.github/get-context7-docs/` - GitHub Action for fetching Context7 docs
- `.github/download-start-kit-release/` - GitHub Action for downloading start-kit resources
- `.github/scripts/download-start-kit-release.cjs` - Start-kit download script
- `src/tools/scaffolding/resources.ts` - Bundled template resources (was .gitignored)

**Files Modified**:
- `package.json` - Removed `create:docs` script, simplified build to just TypeScript compilation
- `src/server.ts` - Removed `registerAllResources` import and call
- `src/tools/index.ts` - Removed `registerContextTools` import and call
- `src/prompts/scaffolding.ts` - Updated to reference skills instead of get-fastedge-context tool
- `src/prompts/deploying.ts` - Removed get-fastedge-context reference, added inline dotenv documentation
- `.github/workflows/create-release.yaml` - Removed "Get Context7 Docs" and "Download Start Kit" steps
- `.gitignore` - Removed reference to src/tools/scaffolding/resources.ts
- `context/PROJECT_OVERVIEW.md` - Updated to reflect new architecture (no resources)
- `claude.md` - Updated project structure and removed resource references

### Impact
- **Cleaner separation of concerns**: MCP server = build + deploy, Skills = documentation
- **No external dependencies**: No Context7 API or GitHub releases dependency
- **Simpler build process**: Just `tsc` compilation, no doc/template download steps
- **Runtime template fetching**: Uses `npx create-fastedge-app` instead of bundled templates
- **Single source of truth**: All FastEdge documentation and templates live in create-fastedge-app
- **Smaller codebase**: Removed ~2000+ lines of generated resource/template code
- **Cleaner releases**: Docker builds no longer download external assets

### Build Changes
```bash
# Old
pnpm run build  # Ran create:docs + tsc

# New
pnpm run build  # Just tsc
```

**MCP Server Tools** (after cleanup):
- Build: `build-wasm`
- Deploy: `upload-binary`, `update-or-create-app`, `update-env-vars-app`, `get-secret-id`
- Scaffold: `list-fastedge-templates`, `scaffold-fastedge-project`
- Tracking: `deployment-comments`

**Documentation Access**:
- Generated projects include `.claude/skills/` with comprehensive FastEdge docs
- Skills include: fastedge-development, fastedge-debugging, fastedge-deployment, fastedge-examples

### Testing
```bash
pnpm run build          # Should succeed with just TypeScript compilation
pnpm run server:dev     # Server should start without resource registration
```

**Verified**:
- ✅ Build compiles successfully
- ✅ No references to removed code in src/
- ✅ Prompts updated to reference skills instead of resources
- ✅ Documentation updated to reflect new architecture

---

## [2026-02-10] - MCP Server Refactoring & Deduplication

### Overview
Removed duplicate template code and context assets. MCP server now delegates to create-fastedge-app CLI for scaffolding, eliminating 1MB+ of duplication.

### What Was Completed

**Scaffold Tool Refactored**:
- File: `src/tools/scaffolding/scaffolds.ts`
- Changed from bundled templates to `npx create-fastedge-app`
- Removed dependency on `FastEdgeTemplates` from resources.ts
- Updated tool descriptions to mention skills

**Files Removed**:
- `src/tools/scaffolding/resources.ts` (1MB+ duplicate template code)
- `assets/context/` directory (content moved to skills)
  - `assets/context/fastedge-core.md` migrated to create-fastedge-app skills

**Files Moved**:
- `assets/context/dotenv.md` → `docs/dotenv.md` (MCP-specific docs preserved)

**Files Modified**:
- `README.md` - Updated dotenv.md path reference
- `src/tools/scaffolding/scaffolds.ts` - Delegates to CLI

### Implementation Details

**New Scaffold Pattern**:
```typescript
// Old: Read from bundled FastEdgeTemplates
const template = FastEdgeTemplates[templateType].find(...)

// New: Delegate to create-fastedge-app CLI
const command = `npx create-fastedge-app "${outputPath}" --template ${template} --language ${language}`;
await execAsync(command);
```

**List Templates Tool**:
- Now returns static list of available templates
- Mentions skills included in generated projects
- No longer depends on bundled resources

### Impact
- **30-40% smaller codebase** (~1MB removed)
- **Single source of truth** - create-fastedge-app owns templates
- **Skills-based context** - No hardcoded documentation
- **Easier maintenance** - Update templates in one place
- **Better discoverability** - Skills load dynamically

**Code Changes**:
- Lines removed: ~1,200 (resources.ts + context assets)
- Files deleted: 2+ (resources.ts, context directory)
- Files modified: 2 (scaffolds.ts, README.md)

### Testing
```bash
# Test scaffold tool (requires MCP server running)
# Use MCP: scaffold-fastedge-project
# Verify: Creates project using create-fastedge-app
# Verify: Generated project includes .claude/skills/
```

**Part of**: FastEdge Ecosystem Refactoring - Phase 2: MCP Server Refactoring

### Notes
- MCP server now requires create-fastedge-app to be available via npx
- Docker container already includes Node.js and npm
- Skills are now the source of truth for FastEdge documentation

---

## Format for New Entries

```markdown
## [YYYY-MM-DD] - Feature/Tool/Fix Name

### Overview
Brief description of what was accomplished

### 🎯 What Was Completed

#### 1. Component/Tool Name
- Detail 1
- Detail 2

**Files Modified:**
- path/to/file.ts - What changed

**Files Created:**
- path/to/file.ts - Purpose

### 🧪 Testing
How to test the changes

### 📝 Notes
Any important context, decisions, or gotchas
```

---

## [2026-02-09] - Initial Context Documentation

### Overview
Created comprehensive context documentation system following discovery-based pattern for the FastEdge MCP Server repository.

### 🎯 What Was Completed

#### 1. Core Documentation Structure
- Created `claude.md` - Top-level agent instructions for MCP server (~400 lines)
- Created `context/CONTEXT_INDEX.md` - Navigation hub with decision tree (~150 lines)
- Created `context/PROJECT_OVERVIEW.md` - Comprehensive MCP server overview (~350 lines)
- Created `context/SEARCH_GUIDE.md` - Search patterns guide (~80 lines)
- Created `context/CHANGELOG.md` - This file (searchable history)

**Files Created:**
- `claude.md` - Top-level instructions
- `context/CONTEXT_INDEX.md` - Documentation navigation
- `context/PROJECT_OVERVIEW.md` - Project overview
- `context/SEARCH_GUIDE.md` - Search patterns
- `context/CHANGELOG.md` - This file

**Directory Structure Created:**
- `context/architecture/` - For architecture docs
- `context/tools/` - For tool-specific docs
- `context/prompts/` - For prompt workflow docs
- `context/resources/` - For resource system docs
- `context/development/` - For development guides

### 📝 Notes

**Documentation Philosophy:**
- Discovery-based: Read only what's needed for current task
- Token-efficient: Prevents reading thousands of unnecessary lines
- Decision-tree driven: Quick lookup for common tasks
- Searchable: Use grep instead of linear reading

**Coverage:**
- Core overview: MCP protocol, server architecture, capabilities
- Project structure and tech stack
- Integration with FastEdge API
- Template system and Magic Comments

**Future Documentation Needed:**

**Architecture**:
- `architecture/MCP_PROTOCOL.md` - MCP basics and protocol details
- `architecture/SERVER_ARCHITECTURE.md` - Server lifecycle and structure
- `architecture/API_CLIENT.md` - FastEdge API client implementation
- `architecture/WORKSPACE_UTILS.md` - File operations and workspace utils

**Tools**:
- `tools/TOOL_DEVELOPMENT.md` - How to create/modify tools
- `tools/BUILD_WASM.md` - build-wasm tool details
- `tools/UPLOAD_BINARY.md` - upload-binary tool
- `tools/DEPLOY_APP.md` - update-or-create-app tool
- `tools/DEPLOY_ENV_VARS.md` - update-env-vars-app tool
- `tools/SCAFFOLDING_SYSTEM.md` - scaffold-fastedge-project tool
- `tools/MAGIC_COMMENTS.md` - deployment-comments tool
- `tools/FASTEDGE_API.md` - FastEdge API tools overview

**Prompts**:
- `prompts/PROMPT_SYSTEM.md` - How prompts work in MCP
- `prompts/CREATE_APP_PROMPT.md` - createFastEdgeApp workflow
- `prompts/DEPLOY_APP_PROMPT.md` - deployFastEdgeApp workflow
- `prompts/ENV_VARS_PROMPT.md` - setEnvironmentVariables workflow

**Resources**:
- `resources/RESOURCE_SYSTEM.md` - How resources work
- `resources/FASTEDGE_CONTEXT.md` - fastedge-context resource details
- `resources/CONTENT_GENERATION.md` - How bundled docs are generated

**Development**:
- `development/IMPLEMENTATION_GUIDE.md` - Coding patterns and conventions
- `development/TESTING_GUIDE.md` - Testing MCP server
- `development/MCP_INSPECTOR.md` - Using MCP inspector for debugging

---

**Note**: Add new entries at the TOP of this file (reverse chronological order)
