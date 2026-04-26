// One-off: regenerate src/app/favicon.ico from public/logo.svg so older
// browsers serving /favicon.ico see the same Kalanjiyam mark as Safari/
// Chrome (which use src/app/icon.svg via Next.js auto-discovery).
//
// Modern browsers happily render a PNG-encoded .ico; we ship a 64×64 PNG
// renamed to favicon.ico, which is sufficient for tab + bookmark sizes.
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const svgPath = path.join(root, "public", "logo.svg");
const outPath = path.join(root, "src", "app", "favicon.ico");

const svg = await fs.readFile(svgPath);
const png = await sharp(svg, { density: 384 }).resize(64, 64).png().toBuffer();
await fs.writeFile(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
