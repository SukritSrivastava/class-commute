/**
 * Generates the app icon set into `public/icons/`.
 *
 * ## The mark
 *
 * A journey line: a single stroke climbing left to right through the sunset
 * gradient, with the origin as a hollow magenta ring and the destination as a
 * filled gold dot — gold because that is the app's "best pick" colour, and the
 * destination is the whole point of the thing. It is the same palette and the
 * same restraint as the rest of the identity, and it survives being 48px on a
 * cluttered home screen, which a train time set in Archivo would not.
 *
 * Two variants:
 *   - `any`: the mark on night, filling the tile.
 *   - `maskable`: the same mark scaled to ~62% and centred, so Android can crop
 *     it to a circle, a squircle or a rounded square without clipping the dots.
 *     The safe zone is the inner 80% of the tile; the mark stays well inside it.
 *
 * Run with:  npm run icons:build
 * Renders through Playwright's Chromium, which is already a dev dependency —
 * no image toolchain, and the PNGs come out of the same engine that will
 * display them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(REPO_ROOT, "public", "icons");

const NIGHT = "#0A0510";

/**
 * The mark, on a 0..100 viewBox so one definition serves every size.
 * `inset` shrinks it towards the centre for the maskable variant.
 */
function markSvg(inset: number): string {
  const s = (v: number) => (50 + (v - 50) * inset).toFixed(2);

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <defs>
    <linearGradient id="sunset" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#7B2FF7"/>
      <stop offset="38%" stop-color="#FF2D78"/>
      <stop offset="72%" stop-color="#FF7A29"/>
      <stop offset="100%" stop-color="#FFC24B"/>
    </linearGradient>
    <radialGradient id="bloom" cx="50%" cy="0%" r="85%">
      <stop offset="0%" stop-color="#7B2FF7" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#7B2FF7" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="100" height="100" fill="${NIGHT}"/>
  <rect width="100" height="100" fill="url(#bloom)"/>

  <!-- The journey: one deliberate stroke, origin low-left to destination high-right. -->
  <path
    d="M ${s(26)} ${s(74)} L ${s(74)} ${s(26)}"
    stroke="url(#sunset)"
    stroke-width="${(9 * inset).toFixed(2)}"
    stroke-linecap="round"
    fill="none"
  />

  <!-- Origin: hollow, because you haven't left yet. -->
  <circle
    cx="${s(26)}" cy="${s(74)}" r="${(8.5 * inset).toFixed(2)}"
    fill="${NIGHT}" stroke="#FF2D78" stroke-width="${(4 * inset).toFixed(2)}"
  />

  <!-- Destination: solid gold. Same colour as the best pick. -->
  <circle cx="${s(74)}" cy="${s(26)}" r="${(9 * inset).toFixed(2)}" fill="#FFC24B"/>
</svg>`.trim();
}

interface IconSpec {
  file: string;
  size: number;
  /** 1 fills the tile; below 1 keeps the mark inside Android's safe zone. */
  inset: number;
}

const ICONS: IconSpec[] = [
  { file: "icon-192.png", size: 192, inset: 1 },
  { file: "icon-512.png", size: 512, inset: 1 },
  // Android crops a maskable icon to whatever shape the launcher uses. Only the
  // inner 80% is guaranteed visible, so the mark sits at 62% with room to spare.
  { file: "icon-maskable-192.png", size: 192, inset: 0.62 },
  { file: "icon-maskable-512.png", size: 512, inset: 0.62 },
  // iOS does not read the manifest for this. It also composites onto its own
  // rounded rect and never applies transparency, so this one is full-bleed.
  { file: "apple-touch-icon.png", size: 180, inset: 1 },
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // The SVG source ships too: browsers that prefer a vector get one, and it is
  // the reviewable definition of the mark.
  writeFileSync(join(OUT_DIR, "icon.svg"), `${markSvg(1)}\n`, "utf8");

  const browser = await chromium.launch();
  try {
    for (const { file, size, inset } of ICONS) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });

      await page.setContent(
        `<!doctype html><meta charset="utf-8">
         <style>html,body{margin:0;padding:0;background:${NIGHT}}
                svg{display:block;width:${size}px;height:${size}px}</style>
         ${markSvg(inset)}`,
        { waitUntil: "load" }
      );

      await page.screenshot({ path: join(OUT_DIR, file), omitBackground: false });
      await page.close();
      console.log(`  ${file.padEnd(26)} ${size}x${size}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${ICONS.length} icons + icon.svg written to public/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
