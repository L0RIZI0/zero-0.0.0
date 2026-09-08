// Runs `next build` for the DESKTOP target, emitting a static export (`output: 'export'`,
// set in next.config.mjs when BUILD_TARGET=electron). This is the SHARED export step the
// WebView2 shell packs (scripts/build-shell.mjs); Electron is gone (M4b, Sep 2026).
//
// ⚠️ The `BUILD_TARGET=electron` / `NEXT_PUBLIC_ZERO_ELECTRON` token is LEGACY but LOAD-BEARING:
// it's the "packaged static desktop export" signal read by next.config.mjs AND by frozen
// version snapshots (lib/zero-000, lib/zero-002, components/zero-002, …) that must keep
// building unchanged, so the name is deliberately kept despite Electron being removed.
//
// WHY this wrapper exists: a static export can only contain statically-renderable GET
// route handlers. Our `app/api/*` routes are server-only — `entities-bible` (force-dynamic
// + PUT), `parse-schedule` (POST + AI Gateway), `web-title` (force-dynamic fetch proxy) —
// so `next build` aborts with "cannot be used with output: export". None of them can run in
// the desktop shell anyway: it serves a static bundle off the `https://zero.local` protocol
// with no Node server. So we TEMPORARILY move `app/api` out of the route tree for the export
// build, then ALWAYS restore it (finally) so the working tree / normal web build is untouched.
//
// The client degrades gracefully when these endpoints are absent (fetches are caught and
// fall back), and the web-title effect skips the call entirely under NEXT_PUBLIC_ZERO_ELECTRON.

import { rename, access, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

const root = process.cwd()
const apiDir = path.join(root, "app", "api")
const stashDir = path.join(root, ".electron-api-stash")
const outDir = path.join(root, "out")

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function restore() {
  // Move the stashed routes back into the app tree if they're parked.
  if ((await exists(stashDir)) && !(await exists(apiDir))) {
    await rename(stashDir, apiDir)
  }
}

// The export uses `assetPrefix: './'` (relative) so it can be served from the virtual host root.
// That resolves correctly ONLY for the root document (out/index.html at https://zero.local/): its
// `./_next/…` → https://zero.local/_next/… ✓. But a SUBPATH document such as the M3 menu overlay
// (out/menu/index.html served at https://zero.local/menu/) resolves `./_next/…` to
// https://zero.local/menu/_next/… which does NOT exist — so the page's JS/CSS 404, React never
// boots, and the overlay never renders (the "no right-click menu anywhere" bug on v0.2.365).
//
// The `_next/` bundle only ever lives at the export root, so rewrite the menu document's relative
// `./_next/` (and `./favicon`-style root assets) to ROOT-ABSOLUTE `/_next/`, which resolves under the
// virtual host at any depth. We touch ONLY this subpath document, so the shell root and the frozen
// version snapshots keep their relative paths untouched. Next's runtime derives its chunk publicPath
// from where its own bootstrap script loaded, so fixing the initial script srcs cascades to lazy chunks.
async function fixSubpathAssets() {
  const menuHtml = path.join(outDir, "menu", "index.html")
  if (!(await exists(menuHtml))) {
    console.warn("[static-export] out/menu/index.html not found; skipping subpath asset fix")
    return
  }
  const src = await readFile(menuHtml, "utf8")
  const fixed = src.replaceAll("./_next/", "/_next/")
  if (fixed !== src) {
    await writeFile(menuHtml, fixed, "utf8")
    console.log("[static-export] rewrote out/menu/index.html asset paths ./_next/ → /_next/")
  } else {
    console.warn("[static-export] out/menu/index.html had no ./_next/ refs to rewrite")
  }
}

async function runNextBuild() {
  // Resolve Next's CLI entry and run it with the current node so we don't depend on
  // `node_modules/.bin` being on PATH (it isn't in every runner/sandbox).
  const nextBin = require.resolve("next/dist/bin/next")
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, "build"], {
      stdio: "inherit",
      env: { ...process.env, BUILD_TARGET: "electron" },
    })
    child.on("error", reject)
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build exited with code ${code}`))))
  })
}

async function main() {
  // Recover from a previously interrupted run (stash parked, api missing).
  await restore()

  const hadApi = await exists(apiDir)
  if (hadApi) {
    await rename(apiDir, stashDir)
  }
  try {
    await runNextBuild()
    await fixSubpathAssets() // repair the menu overlay's subpath asset URLs (see fixSubpathAssets)
  } finally {
    if (hadApi) await restore()
  }
}

main().catch((err) => {
  console.error("[static-export]", err.message)
  process.exit(1)
})
