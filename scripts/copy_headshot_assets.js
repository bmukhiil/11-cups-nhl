const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "data", "hockey_reference_headshots");
const TARGET = path.join(ROOT, "app", "public", "headshots");

function copyHeadshots() {
  if (!fs.existsSync(SOURCE)) {
    console.log("No headshot source directory found; skipping.");
    return { copied: 0 };
  }
  fs.mkdirSync(TARGET, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jpg")) continue;
    fs.copyFileSync(path.join(SOURCE, entry.name), path.join(TARGET, entry.name));
    copied += 1;
  }
  console.log(`Copied ${copied} headshots to ${path.relative(ROOT, TARGET)}`);
  return { copied };
}

if (require.main === module) {
  copyHeadshots();
}

module.exports = { copyHeadshots };
