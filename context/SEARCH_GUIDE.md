# Search Guide - FastEdge MCP Server

Quick reference for searching documentation efficiently.

---

## Why Search Instead of Read?

**CHANGELOG.md** and other large docs can be thousands of lines. **Searching is 10-20x faster** than reading linearly and uses far fewer tokens.

---

## Searching CHANGELOG.md

**NEVER read CHANGELOG.md linearly** - Always use grep or search tools.

### Common Searches

**Find tool additions/changes**:
```bash
grep -i "build-wasm" context/CHANGELOG.md
grep -i "tool.*add" context/CHANGELOG.md
grep -i "deploy" context/CHANGELOG.md
```

**Find prompt changes**:
```bash
grep -i "prompt" context/CHANGELOG.md
grep -i "createFastEdgeApp" context/CHANGELOG.md
grep -i "workflow" context/CHANGELOG.md
```

**Find bug fixes**:
```bash
grep -i "fix.*bug" context/CHANGELOG.md
grep -i "fix.*api" context/CHANGELOG.md
grep -i "fix.*build" context/CHANGELOG.md
```

**Find API changes**:
```bash
grep -i "api" context/CHANGELOG.md
grep -i "fastedge.*api" context/CHANGELOG.md
```

**Find resource changes**:
```bash
grep -i "resource" context/CHANGELOG.md
grep -i "context.*doc" context/CHANGELOG.md
```

**Date-based searches**:
```bash
grep "## \[2026-" context/CHANGELOG.md  # All 2026 entries
grep "## \[2026-02" context/CHANGELOG.md  # February 2026
```

### Context Around Matches

**Show 3 lines before and after**:
```bash
grep -C 3 "build-wasm" context/CHANGELOG.md
```

**Show 5 lines after**:
```bash
grep -A 5 "## \[2026" context/CHANGELOG.md
```

---

## Finding Tool Documentation

**List all tool docs**:
```bash
ls context/tools/
```

**Find specific tool**:
```bash
ls context/tools/ | grep -i "build"
ls context/tools/ | grep -i "deploy"
```

---

## Finding Prompt Documentation

**List all prompt docs**:
```bash
ls context/prompts/
```

**Find specific prompt**:
```bash
ls context/prompts/ | grep -i "create"
ls context/prompts/ | grep -i "deploy"
```

---

## Searching Across All Context

**Search all files for keyword**:
```bash
grep -r "MCP protocol" context/
grep -r "FastEdge API" context/
grep -r "Magic Comments" context/
```

**Case-insensitive**:
```bash
grep -ri "wasm" context/
```

**With line numbers**:
```bash
grep -rn "build-wasm" context/
```

---

## Searching Within Specific Docs

**Architecture docs**:
```bash
grep -i "tool" context/architecture/MCP_PROTOCOL.md
grep -i "api" context/architecture/API_CLIENT.md
```

**Tool docs**:
```bash
grep -i "rust" context/tools/BUILD_WASM.md
grep -i "binary" context/tools/UPLOAD_BINARY.md
```

---

## Common Search Patterns

| Looking for | Search Pattern |
|-------------|----------------|
| How tool works | `grep -ri "tool-name" context/tools/` |
| When tool was added | `grep -i "tool-name" context/CHANGELOG.md` |
| Bug fix history | `grep -i "fix.*keyword" context/CHANGELOG.md` |
| API integration | `grep -ri "fastedge api" context/` |
| Prompt workflow | `grep -i "prompt-name" context/prompts/` |
| Build/compilation | `grep -ri "wasm\|build" context/tools/` |
| MCP concepts | `grep -ri "mcp" context/architecture/` |

---

## VS Code Search

**Use VS Code's built-in search** (Ctrl+Shift+F / Cmd+Shift+F):
- Search scope: `context/`
- Case-insensitive: Toggle icon
- Regex: Toggle icon
- Include/exclude patterns

**Example queries**:
- `build-wasm` in `context/`
- `MCP protocol` in `context/architecture/`
- `@gcoredev` (find all package references)

---

## Grep Tool in Claude Code

**Preferred method when using Claude Code**:
```typescript
Grep tool with:
- pattern: "search-term"
- path: "context/"
- output_mode: "content" (with context)
- -i: true (case-insensitive)
```

**Benefits**:
- Respects .gitignore
- Optimized for codebases
- Returns formatted results

---

## When to Read vs Search

**Read entire doc when**:
- Learning about new tool/feature (<500 lines)
- Understanding architecture overview
- First time working in area

**Search instead when**:
- Looking for specific information
- Checking if feature exists
- Finding implementation details
- Reviewing change history

---

## Key Takeaways

1. **Always search CHANGELOG.md** - Never read linearly
2. **grep is your friend** - Fast, powerful, token-efficient
3. **Use -i for case-insensitive** - Catches more matches
4. **Use -r for recursive** - Search across all files
5. **Context flags (-C, -A, -B)** - See surrounding lines
6. **VS Code search** - When you need interactive results

---

**Last Updated**: February 2026
