// Deterministically renders Zero's app icon: a crisp geometric lowercase "z"
// (two horizontal bars + a slanted diagonal, in the angular Geist style) in white
// on a flat full-bleed near-black tile. Vector → PNG via sharp, so there is zero
// grain/noise and the mark is pixel-exact and perfectly centered (unlike an AI
// raster). Regenerate with:  node scripts/make-icon.mjs
import sharp from "sharp"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const S = 1024 // canvas size
const BG = "#0A0A0A" // flat app-icon tile (theme-independent, like a real favicon)
const FG = "#FFFFFF"

// Letter box, centered on the canvas (center = 512,512).
const L = 322
const R = 702 // width 380 → center x 512
const Tp = 342
const Bt = 682 // height 340 → center y 512
const t = 84 // bar / diagonal thickness

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" fill="${BG}"/>
  <g fill="${FG}">
    <!-- top bar -->
    <rect x="${L}" y="${Tp}" width="${R - L}" height="${t}"/>
    <!-- bottom bar -->
    <rect x="${L}" y="${Bt - t}" width="${R - L}" height="${t}"/>
    <!-- diagonal: top-right down to bottom-left, flush with both bars -->
    <polygon points="${R - t},${Tp + t} ${R},${Tp + t} ${L + t},${Bt - t} ${L},${Bt - t}"/>
  </g>
</svg>`

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const png = await sharp(Buffer.from(svg)).png().toBuffer()

// build/icon.png  → electron-builder auto-detects this as the packaged app icon
//                   (generates the .ico / .icns / AppImage icon at build time).
// electron/icon.png → bundled with the app (files: electron/**) so the runtime
//                   BrowserWindow can set the live window / taskbar / dock icon.
for (const rel of ["build/icon.png", "electron/icon.png"]) {
  const outFile = join(root, rel)
  await sharp(png).toFile(outFile)
  console.log("[make-icon] wrote", outFile)
}
