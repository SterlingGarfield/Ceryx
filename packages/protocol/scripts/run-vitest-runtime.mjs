import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startVitest } from "vitest/node";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const runtimeRoot = path.resolve(packageRoot, ".codex-runtime", `protocol-runtime-${process.pid}-${Date.now()}`);
const runtimeOutDir = path.join(runtimeRoot, "out");
const runtimeTestFile = path.join(runtimeOutDir, "protocol.test.js");
const require = createRequire(import.meta.url);
const tscPath = require.resolve("typescript/bin/tsc");

const compile = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.runtime.json", "--outDir", runtimeOutDir], {
  cwd: packageRoot,
  stdio: "inherit"
});

if (compile.error) {
  console.error(compile.error);
}

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

await startVitest(
  "test",
  [runtimeTestFile],
  {
    root: runtimeOutDir,
    config: false,
    run: true,
    pool: "threads"
  },
  {
    resolve: {
      preserveSymlinks: true
    }
  }
);
