const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "src");

function collectJsFiles(dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectJsFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".js")) {
      result.push(fullPath);
    }
  }

  return result;
}

const files = [path.join(projectRoot, "server.js"), ...collectJsFiles(sourceRoot)];
let hasErrors = false;

for (const filePath of files) {
  const check = spawnSync("node", ["--check", filePath], {
    stdio: "inherit",
  });

  if (check.status !== 0) {
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`Syntax check OK (${files.length} files)`);
