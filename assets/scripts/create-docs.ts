#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTEXT7_APIKEY = "ctx7sk-1fa70e70-cc5f-4d71-863c-3a7cf1777c7f"; // todo: Farq: Move to .env files..

/**
 * Script to automatically update FastEdge documentation by:
 * 1. Fetching (Context7) SDK documentation from https://g-core.github.io/FastEdge-sdk-js/
 * 2. Fetching (Context7) examples from https://github.com/G-Core/FastEdge-examples
 * 3. Using all markdown files at ./docs/context/* to create core context.
 *
 */

/**
 * Fetch Context7 content
 */
async function fetchContext7Content(context7Key: string): Promise<string> {
  console.log("🔍 Fetching Context7 content...");

  try {
    // Use GitHub API to fetch repository contents
    const apiUrl = `https://context7.com/api/v1/${context7Key}?type=txt`;
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${CONTEXT7_APIKEY}`,
      },
    });
    return await response.text();
  } catch (error) {
    console.error("Failed to fetch context7Key:", context7Key, error);
    return "";
  }
}

async function readFileContent(inputPath: string): Promise<string> {
  console.log("🔍 Reading documentation content...");
  try {
    const resourcePath = path.join(__dirname, inputPath);
    return await fs.readFile(resourcePath, "utf-8");
  } catch (error) {
    console.error("Failed to read file:", error);
    return "";
  }
}

async function writeResourceFile(
  dir: string,
  outputName: string,
  content: string
): Promise<void> {
  try {
    console.log("📝 Writing resource file...", dir, outputName);
    const resourceDir = path.join(__dirname, dir);
    const resourceMdFile = path.join(resourceDir, `${outputName}.md`);
    const resourceTSFile = path.join(resourceDir, `${outputName}.ts`);
    await fs.mkdir(resourceDir, { recursive: true });
    await fs.writeFile(resourceMdFile, content, "utf-8");
    await fs.writeFile(
      resourceTSFile,
      `export const ${outputName} = ${JSON.stringify(content)};`,
      "utf-8"
    );
  } catch (error) {
    console.error("Failed to write resource files:", error);
  }
}

async function createLocalFileContent(
  localConfig: {
    inputFile: string;
    outputName: string;
    outputPath: string;
  }[]
): Promise<void> {
  try {
    for (const config of localConfig) {
      const content = await readFileContent(config.inputFile);
      await writeResourceFile(config.outputPath, config.outputName, content);
    }
  } catch (err) {
    console.error("❌ Error updating documentation:", err);
  }
}

async function createContext7Content(
  context7Config: {
    key: string;
    outputName: string;
    outputPath: string;
  }[]
): Promise<void> {
  try {
    for (const config of context7Config) {
      const content = await fetchContext7Content(config.key);
      await writeResourceFile(config.outputPath, config.outputName, content);
    }
  } catch (err) {
    console.error("❌ Error updating Context7 documentation:", err);
  }
}

async function main() {
  try {
    await createLocalFileContent([
      {
        inputFile: "../context/fastedge-core.md",
        outputName: "fastedge",
        outputPath: "../../src/resources/fastedge-core/",
      },
      {
        inputFile: "../context/dotenv.md",
        outputName: "dotenv",
        outputPath: "../../src/resources/dotenv/",
      },
    ]);
    await createContext7Content([
      {
        key: "g-core/fastedge-examples",
        outputName: "examples",
        outputPath: "../../src/resources/fastedge-examples/",
      },
      {
        key: "websites/g-core_github_io_fastedge-sdk-js",
        outputName: "docs",
        outputPath: "../../src/resources/fastedge-sdk-js/",
      },
    ]);
  } catch (err) {
    console.error("❌ Error updating documentation:", err);
  }
}

main();
