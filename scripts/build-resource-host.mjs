// Publishes the WebView2 resource host (native/resource-host) into a self-contained,
// single-file win-x64 .exe that electron-builder then bundles via `extraResources`
// (build.extraResources maps native/resource-host/publish → resources/resource-host).
//
// Runs as part of `pnpm electron:build` / `electron:build:ci`, BEFORE electron-builder.
// Windows-only surface, but the publish itself can run on any OS with the .NET SDK; the
// GitHub release workflow runs it on windows-latest (see .github/workflows/release.yml,
// which adds a setup-dotnet step). If the .NET SDK is missing we FAIL LOUDLY — a packaged
// build without the host would silently fall back to the old WebContentsView path and the
// whole point of the migration (Google login) would regress unnoticed.

import { spawn } from "node:child_process"
import { rm, access } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const projDir = path.join(root, "native", "resource-host")
const proj = path.join(projDir, "ResourceHost.csproj")
const outDir = path.join(projDir, "publish")

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts })
    child.on("error", reject)
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))))
  })
}

async function main() {
  if (!(await exists(proj))) {
    throw new Error(`resource host project not found at ${proj}`)
  }
  // Clean prior output so a stale exe can't ship.
  await rm(outDir, { recursive: true, force: true })

  // Self-contained single-file publish. -p:HostPublish=true flips on the single-file/self-contained/RID
  // property group in the csproj (kept OFF for dev builds so `dotnet run` stays fast).
  await run("dotnet", [
    "publish",
    proj,
    "-c",
    "Release",
    "-o",
    outDir,
    "--nologo",
    "-p:HostPublish=true",
  ])

  console.log(`[build-resource-host] published → ${outDir}`)
}

main().catch((err) => {
  console.error("[build-resource-host]", err.message)
  process.exit(1)
})
