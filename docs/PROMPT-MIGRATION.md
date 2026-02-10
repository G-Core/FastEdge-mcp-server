# Prompt Migration: Old to New /createFastEdgeApp

## Summary

The old simple `/createFastEdgeApp` prompt has been replaced with a new intelligent version that handles multiple repository scenarios and mixed-language projects.

## What Changed

### Before (Old Simple Prompt)

**Location**: `src/prompts/scaffolding.ts`

**Behavior**:
- Asked basic questions (language, template, location)
- Always scaffolded to the specified directory
- No context awareness
- No language validation
- Sometimes agent would bypass the MCP tool and run npx directly

**Limitations**:
- Didn't detect existing projects
- Could overwrite package.json/Cargo.toml
- No guidance for monorepos
- No mixed-language support
- No selective file copying

### After (New Smart Prompt)

**Location**: `src/prompts/scaffolding-scenarios.ts`

**Behavior**:
- Detects repository context (package.json, Cargo.toml, existing folders)
- Identifies one of three scenarios automatically
- Validates language matching for Scenario C
- Provides guidance through MCP resources
- Enforces use of MCP tool (no npx bypass)

**Capabilities**:
- ✅ Scenario A: Brand new repository
- ✅ Scenario B: Add package to existing repo (supports mixed languages)
- ✅ Scenario C: Add to existing project (requires language match)
- ✅ TypeScript, JavaScript, and Rust support
- ✅ Mixed-language repository support
- ✅ Monorepo awareness
- ✅ Selective file copying for Scenario C

## Available Prompts

| Prompt | Description | File |
|--------|-------------|------|
| `/createFastEdgeApp` | **NEW Smart scaffolding** - Context-aware, handles all scenarios | `scaffolding-scenarios.ts` |
| `/explainFastEdgeTemplate` | Template explanation and guidance | `scaffolding.ts` |
| `/deployFastEdgeApp` | Build and deploy FastEdge applications | `deploying.ts` |

## Migration Guide for Users

### No Action Required!

The prompt name remains the same: `/createFastEdgeApp`

**What you'll notice:**
1. More intelligent behavior - detects your repo context
2. Asks clarifying questions about scenarios
3. Better handling of existing projects
4. Support for mixed-language repos (TypeScript + Rust)
5. More explicit about using MCP tools (no npx bypass)

### Usage Examples

#### Example 1: New Empty Repo
```
User: /createFastEdgeApp

Agent:
"I've detected an empty workspace (no package.json or Cargo.toml).

This appears to be Scenario A: Brand New Repository
→ I'll scaffold a complete project at the root (./)

Which language would you prefer?
1. TypeScript
2. JavaScript
3. Rust"
```

#### Example 2: Existing TypeScript Repo, Want to Add Rust
```
User: /createFastEdgeApp

Agent:
"I've detected an existing TypeScript project (package.json at root).

Do you want to:
A) Add FastEdge code to your existing TypeScript project (Scenario C)
B) Create a new separate package (Scenario B)

Note: I see you want to use Rust. Since this differs from your existing
TypeScript project, I recommend Scenario B (separate package)."

User: "B - separate package"

Agent:
"Great! Where should I create the Rust package?
Common patterns: ./packages/, ./services/, ./apps/

Suggested: ./services/rust-app/"
```

#### Example 3: Monorepo
```
User: /createFastEdgeApp

Agent:
"I've detected a monorepo structure:
- package.json at root
- ./packages/ directory with existing apps

This appears to be Scenario B: Add New Package

I'll create the new FastEdge app in a subfolder.
Where should it go? (e.g., ./packages/my-new-app)"
```

## Technical Changes

### Files Modified

1. **`src/prompts/scaffolding.ts`**
   - Removed old `createFastEdgeApp` prompt
   - Kept `explainFastEdgeTemplate` prompt
   - Added comment pointing to new location

2. **`src/prompts/scaffolding-scenarios.ts`**
   - Renamed `scaffoldFastEdgeApp` → `createFastEdgeApp`
   - Renamed function `registerScaffoldingScenariosPrompt` → `registerCreateFastEdgeAppPrompt`
   - Updated title and description

3. **`src/prompts/index.ts`**
   - Updated import: `registerScaffoldingScenariosPrompt` → `registerCreateFastEdgeAppPrompt`
   - Added clarifying comment

### New Features Added

1. **Context Detection**:
   - Checks for package.json (TypeScript/JavaScript)
   - Checks for Cargo.toml (Rust)
   - Checks for monorepo structure
   - Checks for existing source folders

2. **Three Scenario Support**:
   - Scenario A: New repo → scaffold at root
   - Scenario B: Existing repo → scaffold in subfolder
   - Scenario C: Add to existing → temp scaffold + selective copy

3. **Language Validation**:
   - Scenario C enforces language matching
   - Warns when trying to add Rust to TypeScript project (suggests Scenario B)
   - Supports mixed-language repos via Scenario B

4. **Resource Integration**:
   - Agent reads `fastedge://guides/scaffolding` for decision tree
   - Agent reads `fastedge://guides/templates` for template selection
   - Resources act like built-in knowledge

5. **Enhanced Tool Enforcement**:
   - Explicit instructions to use MCP tool
   - Multiple "DO NOT run npx directly" warnings
   - Better tool descriptions

## Benefits

### For Users
- ✅ Smarter behavior - detects context automatically
- ✅ Safer - won't accidentally overwrite existing manifests
- ✅ Mixed languages - can have TypeScript + Rust in same repo
- ✅ Monorepo support - handles packages/ structure correctly
- ✅ Selective copying - can add files without full scaffold

### For Agents
- ✅ Clear decision tree via resources
- ✅ Step-by-step instructions
- ✅ Language validation logic
- ✅ Examples for each scenario
- ✅ Troubleshooting guide

### For Developers
- ✅ One prompt handles all scenarios
- ✅ Easy to extend with new scenarios
- ✅ Well-documented in resources
- ✅ Language-agnostic design

## Testing Checklist

- [ ] Empty repo → Scenario A (scaffold at root)
- [ ] TypeScript repo → Add TypeScript (Scenario C)
- [ ] TypeScript repo → Add Rust (Scenario B, subfolder)
- [ ] Rust repo → Add TypeScript (Scenario B, subfolder)
- [ ] Monorepo → Add package (Scenario B, subfolder)
- [ ] Attempt language mismatch in Scenario C → Warning + suggest Scenario B
- [ ] Agent uses `scaffold-fastedge-project` tool (not npx directly)
- [ ] Resources readable: `fastedge://guides/scaffolding`
- [ ] Resources readable: `fastedge://guides/templates`

## Backward Compatibility

✅ **Fully backward compatible**

- Prompt name unchanged: `/createFastEdgeApp`
- Same user experience, just smarter
- No breaking changes to MCP tool
- Existing workflows continue to work

The only difference is better behavior:
- Old: Always scaffolds wherever you say
- New: Asks questions, validates context, suggests best approach

## Rollback Plan

If needed, the old simple prompt can be restored from git history:

```bash
git show HEAD~1:src/prompts/scaffolding.ts > scaffolding.ts.old
# Compare and restore if needed
```

However, the new prompt is strictly better - it handles all the old scenarios plus many new ones.

---

**Migration Date**: February 11, 2026
**Status**: ✅ Complete
**Breaking Changes**: None
**User Action Required**: None
