// Copies only the public site into dist/ for `wrangler pages deploy`.
// Pages direct upload ignores .assetsignore, so anything in the upload
// directory becomes a public URL. Functions are still bundled from ./functions
// (and its ../lib imports) because wrangler reads them from the project root.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const OUT = "dist";
const PUBLIC_DIRS = ["assets", "images"];
const PUBLIC_FILES = ["CNAME"];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

for (const file of readdirSync(".")) {
  if (file.endsWith(".html") || PUBLIC_FILES.includes(file)) {
    cpSync(file, `${OUT}/${file}`);
  }
}

for (const dir of PUBLIC_DIRS) {
  if (existsSync(dir)) {
    cpSync(dir, `${OUT}/${dir}`, { recursive: true });
  }
}

console.log(`Built ${OUT}/: ${readdirSync(OUT).join(", ")}`);
