import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { startVitest } from "vitest/node";

mkdirSync(join(process.cwd(), ".codex-runtime"), { recursive: true });
const runtimeRoot = mkdtempSync(join(process.cwd(), ".codex-runtime", "desktop-"));
const runtimeOutDir = join(runtimeRoot, "out");
const runtimeTsconfigPath = join(runtimeRoot, "tsconfig.runtime.json");
const repoRoot = existsSync(join(process.cwd(), "packages")) ? process.cwd() : join(process.cwd(), "..", "..");

writeFileSync(
  runtimeTsconfigPath,
  JSON.stringify(
    {
      extends: "../../tsconfig.json",
      compilerOptions: {
        noEmit: false,
        outDir: "./out",
        rootDir: "../../src"
      },
      include: ["../../src/**/*.ts", "../../src/**/*.tsx"]
    },
    null,
    2
  )
);

const pnpmExec = process.env.npm_execpath;
const compileResult = spawnSync(
  pnpmExec ? process.execPath : "pnpm",
  pnpmExec
    ? [pnpmExec, "exec", "tsc", "-p", runtimeTsconfigPath]
    : ["exec", "tsc", "-p", runtimeTsconfigPath],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit"
  }
);

if (compileResult.status !== 0) {
  process.exit(compileResult.status ?? 1);
}

function patchJsSpecifiers(rootDir) {
  if (!existsSync(rootDir)) {
    return;
  }

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      patchJsSpecifiers(entryPath);
      continue;
    }

    if (!entry.isFile() || !entryPath.endsWith(".js")) {
      continue;
    }

    const original = readFileSync(entryPath, "utf8");
    const patched = original
      .replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (match, prefix, specifier, suffix) => {
        if (/\.(js|mjs|cjs|json|node)$/.test(specifier)) {
          return match;
        }

        return `${prefix}${specifier}.js${suffix}`;
      })
      .replace(/(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g, (match, prefix, specifier, suffix) => {
        if (/\.(js|mjs|cjs|json|node)$/.test(specifier)) {
          return match;
        }

        return `${prefix}${specifier}.js${suffix}`;
      });

    if (patched !== original) {
      writeFileSync(entryPath, patched);
    }
  }
}

[ 
  join(repoRoot, "packages", "protocol", "dist"),
  join(repoRoot, "packages", "client-sdk", "dist"),
  join(repoRoot, "packages", "ui", "dist"),
  join(repoRoot, "packages", "design-tokens", "dist"),
  join(repoRoot, "packages", "feature-remote-control", "dist"),
  runtimeOutDir
].forEach((dir) => patchJsSpecifiers(dir));

await startVitest(
  "test",
  [
    "console.files-tasks-notifications.test.js",
    "console.settings.test.js",
    "console.windows.test.js"
  ],
  {
    root: runtimeOutDir,
    config: false,
    run: true,
    pool: "threads",
    environment: "jsdom"
  },
  {
    resolve: {
      preserveSymlinks: true
    }
  }
);
