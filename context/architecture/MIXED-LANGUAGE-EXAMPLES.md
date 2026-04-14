# Mixed-Language Repository Examples

This document shows real-world examples of how to structure FastEdge repositories with multiple programming languages.

## Example 1: Rust Primary + TypeScript API

**Use Case**: Performance-critical CDN application in Rust at root, with a TypeScript HTTP API as a separate service.

### Initial State (Empty Repo)
```
workspace/
└── .vscode/
    └── mcp.json
```

### Step 1: Create Rust CDN App at Root (Scenario A)
```
/scaffoldFastEdgeApp
- Scenario: A (New Repository)
- Language: Rust
- Template: cdn-base
- Output: ./
```

**Result:**
```
workspace/
├── .vscode/
├── Cargo.toml           # Rust manifest
├── Cargo.lock
├── src/
│   └── lib.rs           # Rust CDN code
├── .claude/
│   └── skills/
└── README.md
```

### Step 2: Add TypeScript HTTP API (Scenario B)
```
/scaffoldFastEdgeApp
- Scenario: B (Add New Package)
- Language: TypeScript
- Template: http-base
- Output: ./packages/api/
```

**Final Structure:**
```
workspace/
├── .vscode/
├── Cargo.toml           # Rust CDN at root
├── src/
│   └── lib.rs
├── packages/
│   └── api/             # TypeScript HTTP API
│       ├── package.json
│       ├── src/
│       │   └── index.ts
│       └── .claude/
└── README.md
```

### Deployment
- Rust CDN: `cargo build --release --target wasm32-wasip1` → Deploy from ./target/
- TypeScript API: `cd packages/api && npm run build` → Deploy from ./packages/api/dist/

---

## Example 2: TypeScript Primary + Multiple Rust Services

**Use Case**: TypeScript HTTP app at root, with multiple Rust microservices.

### Initial State
```
workspace/
├── package.json         # Existing TypeScript app
├── src/
│   └── index.ts
└── .vscode/
```

### Step 1: Already has TypeScript at root
(Existing application)

### Step 2: Add Rust CDN Service (Scenario B)
```
/scaffoldFastEdgeApp
- Scenario: B (Add New Package)
- Language: Rust
- Template: cdn-base
- Output: ./services/cdn/
```

### Step 3: Add Rust Authentication Service (Scenario B)
```
/scaffoldFastEdgeApp
- Scenario: B (Add New Package)
- Language: Rust
- Template: http-base
- Output: ./services/auth/
```

**Final Structure:**
```
workspace/
├── package.json         # Root TypeScript app
├── src/
│   └── index.ts
├── services/
│   ├── cdn/             # Rust CDN service
│   │   ├── Cargo.toml
│   │   └── src/
│   │       └── lib.rs
│   └── auth/            # Rust auth service
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs
└── .vscode/
```

### Deployment
- TypeScript root: `npm run build` → Deploy from ./dist/
- Rust CDN: `cd services/cdn && cargo build ...` → Deploy
- Rust Auth: `cd services/auth && cargo build ...` → Deploy

---

## Example 3: Monorepo with All Languages

**Use Case**: Learning/examples repository demonstrating FastEdge in all supported languages.

### Step 1: Create TypeScript Example (Scenario A)
```
/scaffoldFastEdgeApp
- Scenario: A (New Repository)
- Language: TypeScript
- Template: http-react-hono
- Output: ./
```

Wait, this doesn't make sense for a monorepo. Let's restart:

### Better Approach: Start with Folder Structure

**Initial State (Empty):**
```
workspace/
└── .vscode/
```

### Step 1: TypeScript HTTP Example (Scenario B, even though empty)
```
/scaffoldFastEdgeApp
- Scenario: B (treat as monorepo from start)
- Language: TypeScript
- Template: http-base
- Output: ./examples/http-typescript/
```

### Step 2: JavaScript HTTP Example
```
/scaffoldFastEdgeApp
- Scenario: B
- Language: JavaScript
- Template: http-react
- Output: ./examples/http-javascript/
```

### Step 3: Rust HTTP Example
```
/scaffoldFastEdgeApp
- Scenario: B
- Language: Rust
- Template: http-base
- Output: ./examples/http-rust/
```

### Step 4: Rust CDN Example
```
/scaffoldFastEdgeApp
- Scenario: B
- Language: Rust
- Template: cdn-base
- Output: ./examples/cdn-rust/
```

**Final Structure:**
```
workspace/
├── .vscode/
├── examples/
│   ├── http-typescript/
│   │   ├── package.json
│   │   ├── src/
│   │   └── .claude/
│   ├── http-javascript/
│   │   ├── package.json
│   │   ├── src/
│   │   └── .claude/
│   ├── http-rust/
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   └── .claude/
│   └── cdn-rust/
│       ├── Cargo.toml
│       ├── src/
│       └── .claude/
└── README.md
```

### Optional: Add Root Workspace Config

**For TypeScript examples (package.json at root):**
```json
{
  "name": "fastedge-examples",
  "private": true,
  "workspaces": [
    "examples/http-typescript",
    "examples/http-javascript"
  ]
}
```

**For Rust examples (Cargo.toml at root):**
```toml
[workspace]
members = [
    "examples/http-rust",
    "examples/cdn-rust"
]
```

**Or separate files for each language:**
No shared workspace - each example is completely independent.

---

## Example 4: Adding TypeScript to Existing Rust Project

**Use Case**: You have a Rust project and want to add a TypeScript admin dashboard.

### Initial State
```
workspace/
├── Cargo.toml           # Existing Rust project
├── src/
│   └── lib.rs
└── .vscode/
```

### Step 1: Detect Scenario
```
Agent: "I see you have a Rust project at root.
Do you want to:
A) Add TypeScript code to the existing Rust project (Scenario C - NOT RECOMMENDED, language mismatch)
B) Add TypeScript as a separate package (Scenario B - RECOMMENDED)"

User: "B - separate package"
```

### Step 2: Add TypeScript Dashboard (Scenario B)
```
/scaffoldFastEdgeApp
- Scenario: B (Add New Package)
- Language: TypeScript
- Template: http-react
- Output: ./packages/dashboard/
```

**Final Structure:**
```
workspace/
├── Cargo.toml           # Root Rust project
├── src/
│   └── lib.rs
├── packages/
│   └── dashboard/       # TypeScript dashboard
│       ├── package.json
│       ├── src/
│       │   └── index.tsx
│       └── .claude/
└── .vscode/
```

---

## Example 5: Language Mismatch Warning (Scenario C Error)

### Initial State
```
workspace/
├── Cargo.toml           # Existing Rust project
├── src/
│   └── lib.rs
└── .vscode/
```

### User Attempts Wrong Scenario
```
User: "I want to add TypeScript code to my existing Rust project"

Agent detects:
- Cargo.toml exists (Rust project)
- User wants TypeScript (language mismatch)
- User said "to existing project" (implies Scenario C)

Agent response:
"⚠️ Warning: You have a Rust project (Cargo.toml) but want to add TypeScript code.

Scenario C (add to existing project) requires MATCHING languages:
- Rust → Rust only
- TypeScript → TypeScript only

Would you like to use Scenario B instead?
→ Create TypeScript application in a separate subfolder (e.g., ./packages/ts-app/)
→ Both languages can coexist as separate packages
→ Each can be deployed independently"
```

---

## Key Principles for Mixed-Language Repos

### 1. Scenario Selection by Language Match

| Existing | Want to Add | Scenario | Location |
|----------|-------------|----------|----------|
| None | Any | A | ./ (root) |
| Rust | Rust | C | ./ (merge) |
| Rust | TypeScript | B | ./packages/ or ./services/ |
| TypeScript | TypeScript | C | ./ (merge) |
| TypeScript | Rust | B | ./packages/ or ./services/ |
| Both | Either | B | ./packages/ or ./services/ |

### 2. Manifest Files Never Mix

- **TypeScript package** = package.json + node_modules/ + src/
- **Rust package** = Cargo.toml + target/ + src/
- Never copy package.json into Rust project
- Never copy Cargo.toml into TypeScript project

### 3. Directory Conventions

**Same language packages:**
```
packages/
├── api/           (TS)
├── admin/         (TS)
└── workers/       (TS)
```

**Mixed language packages:**
```
packages/
├── api/           (TS - has package.json)
└── cdn/           (Rust - has Cargo.toml)
```

Or separate by language:
```
typescript/
├── api/
└── admin/

rust/
├── cdn/
└── auth/
```

### 4. Build and Deployment

Each language has its own build process:

**TypeScript:**
```bash
cd packages/api
npm install
npm run build
# Deploy from ./dist/ or ./build/
```

**Rust:**
```bash
cd packages/cdn
cargo build --release --target wasm32-wasip1
# Deploy from ./target/wasm32-wasip1/release/
```

---

## Common Questions

**Q: Can I have a root package in both languages?**
A: No. Choose one language for root, others go in subfolders.

**Q: Should I use a monorepo tool?**
A: Optional:
- TypeScript: Can use workspaces (npm/pnpm/yarn), Lerna, Nx, Turborepo
- Rust: Can use Cargo workspaces
- Mixed: Each language uses its own workspace config

**Q: How do I share code between languages?**
A: You typically don't at the source level. Options:
- Deploy separately and communicate via HTTP
- Use WebAssembly to call Rust from TypeScript
- Share types via code generation

**Q: Which language should be at root?**
A: Depends on your primary use case:
- Performance-critical CDN → Rust at root
- Full-stack web app → TypeScript at root
- Microservices → Neither at root, all in subfolders

---

**Last Updated**: February 11, 2026
