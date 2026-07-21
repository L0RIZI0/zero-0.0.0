// Runs `next build` for the DESKTOP (Electron) target, which emits a static export
// (`output: 'export'`, set in next.config.mjs when BUILD_TARGET=electron).
//
// WHY this wrapper exists: a static export can only contain statically-renderable GET
// route handlers. Our `app/api/*` routes are server-only — `entities-bible` (force-dynamic
// + PUT), `parse-schedule` (POST + AI Gateway), `web-title` (force-dynamic fetch proxy) —
// so `next build` aborts with "cannot be used with output: export". None of them can run in
// the desktop shell anyway: it serves a static bundle off the `app://` protocol with no
// Node server. So we TEMPORARILY move `app/api` out of the route tree for the export build,
// then ALWAYS restore it (finally) so the working tree / normal web build is untouched.
//
// The client degrades gracefully when these endpoints are absent (fetches are caught and
// fall back), and the web-title effect skips the call entirely under NEXT_PUBLIC_ZERO_ELECTRON.

import { rename, access } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)

const root = process.cwd()
const apiDir = path.join(root, "app", "api")
const stashDir = path.join(root, ".electron-api-stash")

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
  } finally {
    if (hadApi) await restore()
  }
}

main().catch((err) => {
  console.error("[electron-build]", err.message)
  process.exit(1)
})
