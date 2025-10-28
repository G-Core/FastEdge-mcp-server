import { spawnSync } from "child_process";

export function compileJavascriptBinary(
  entryFilePath: string,
  wasmBinaryPath: string,
  cwd: string,
  tsconfigPath?: string
) {
  return new Promise<string>(async (resolve, reject) => {
    const jsBuild = spawnSync(
      "npx",
      [
        "fastedge-build",
        "--input",
        entryFilePath,
        "--output",
        wasmBinaryPath,
        ...(tsconfigPath ? ["--tsconfig", tsconfigPath] : []),
      ],
      {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd,
      }
    );

    if (jsBuild.error) {
      reject(jsBuild.error);
    } else if (jsBuild.status !== 0) {
      reject(`Build failed with status ${jsBuild.status}`);
    } else {
      resolve(wasmBinaryPath);
    }
  });
}
