// Generates PWA PNG icons from public/favicon.svg using sharp.
// Run with: npm run generate-icons
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconsDir = join(root, "public", "icons");
const svgPath = join(root, "public", "favicon.svg");

// Charcoal background so maskable icons look right on rounded launchers.
const BG = { r: 40, g: 40, b: 40, alpha: 1 };

async function render(size, outName) {
  const padding = Math.round(size * 0.18);
  const logo = await sharp(svgPath)
    .resize(size - padding * 2, size - padding * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, top: padding, left: padding }])
    .png()
    .toFile(join(iconsDir, outName));
  console.log("wrote", outName);
}

await mkdir(iconsDir, { recursive: true });
await render(192, "icon-192.png");
await render(512, "icon-512.png");
await render(180, "apple-touch-icon.png");
console.log("Done.");
