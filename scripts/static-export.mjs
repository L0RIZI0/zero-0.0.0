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

// SAFETY NET. The export now uses `assetPrefix: '/'` (root-absolute), so every document — root AND
// subpaths like the M3 menu overlay (out/menu/index.html) — already emits `/_next/…`, which resolves
// under the virtual host at any depth (including the Turbopack runtime's own chunk-loading base). This
// pass therefore normally finds nothing to do (it logs "no ./_next/ refs"). It's kept only to catch a
// regression: if the prefix ever reverts to relative `./`, a subpath document's `./_next/…` would
// resolve to `/menu/_next/…` → 404, its chunks would fail, and React would never hydrate the overlay
// (the v0.2.365→369 "menu never renders" saga). Rewriting the menu document's `./_next/` → `/_next/`
// keeps that specific page's INITIAL scripts alive; note it can't fix the runtime chunk's baked-in base,
// which is exactly why the real fix is the absolute assetPrefix, not this pass.
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
