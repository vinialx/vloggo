import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(os.tmpdir(), "opencode");
mkdirSync(base, { recursive: true });
const temp = mkdtempSync(path.join(base, "vloggo-package-test-"));

try {
  const tarballs = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }));
  const tarball = path.join(temp, tarballs[0].filename);
  const packageRoot = path.join(temp, "package");
  execFileSync("tar", ["-xzf", tarball, "-C", temp]);
  for (const file of ["package.json", "README.md", "LICENSE", "build/index.js", "build/index.d.ts"]) {
    assert.ok(readFileSync(path.join(packageRoot, file)), `package must include ${file}`);
  }

  const consumer = path.join(temp, "consumer");
  const modules = path.join(consumer, "node_modules");
  mkdirSync(modules, { recursive: true });
  mkdirSync(path.join(packageRoot, "node_modules"), { recursive: true });
  symlinkSync(path.join(root, "node_modules/nodemailer"), path.join(packageRoot, "node_modules/nodemailer"), "dir");
  symlinkSync(packageRoot, path.join(modules, "vloggo"), "dir");
  symlinkSync(path.join(root, "node_modules/nodemailer"), path.join(modules, "nodemailer"), "dir");
  mkdirSync(path.join(consumer, "src"));
  const packageJson = { private: true, type: "module" };
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(consumer, "package.json"), JSON.stringify(packageJson)));
  const source = `import { VLoggo, type VLoggoConfig } from "vloggo";\nconst options: VLoggoConfig = { outputs: { console: false, text: false, json: false } };\nconst logger = new VLoggo(options);\nlogger.info("PACKAGE_IMPORT", "ok");\nvoid logger.close();\n`;
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path.join(consumer, "src/index.ts"), source));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "src/index.ts"], { cwd: consumer, stdio: "inherit" });
  execFileSync(process.execPath, ["--input-type=module", "-e", `import { VLoggo } from "vloggo"; const logger = new VLoggo({ outputs: { console: false, text: false, json: false } }); logger.info("PACKAGE_IMPORT", "ok"); await logger.close();`], { cwd: consumer, stdio: "inherit" });
  console.info("Packed package import and TypeScript consumer checks passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
