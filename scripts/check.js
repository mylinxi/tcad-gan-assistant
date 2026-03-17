const path = require("path");
const fs = require("fs");

const required = [
  "package.json",
  "README.md",
  "src/extension.js",
  "src/config.js",
  "src/indexer.js",
  "src/search.js",
  "src/vector.js",
  "src/requirement.js",
  "src/caseBased.js",
  "src/prescription.js",
  "src/templates.js",
  "src/diagnostics.js",
  "src/utils.js",
];

let ok = true;
for (const f of required) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) {
    console.error(`[missing] ${f}`);
    ok = false;
  }
}

if (!ok) {
  process.exit(1);
}

const { execSync } = require("child_process");
const jsFiles = required.filter((f) => f.endsWith(".js"));

try {
  for (const f of jsFiles) {
    execSync(`node --check "${f}"`, { stdio: "pipe" });
  }
  console.log("check passed: files + syntax check OK");
} catch (err) {
  const stderr = err?.stderr ? String(err.stderr) : String(err);
  console.error("check failed:", stderr);
  process.exit(1);
}
