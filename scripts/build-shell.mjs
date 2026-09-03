// Packages the Zero WebView2 SHELL (native/shell-host) into a Velopack installer + update feed.
// This is the M4 replacement for `electron-builder` + NSIS. Output lands in `release-shell/`:
//   • releases.win.json   – the feed manifest UpdateManager polls
//   • Zero-<version>-full.nupkg – the update package
//   • Zero-win-Setup.exe  – the one-time bootstrap installer you copy to the Surface for the FIRST install
// scripts/upload-shell-release.mjs then pushes these to the PUBLIC Blob "updates-shell" feed.
//
// Prerequisites (the CI job installs these; on your desktop you already have them via VS + .NET):
//   • .NET 8 SDK            (`dotnet`)
//   • the Velopack CLI      (`vpk`, pinned to the same version as the Velopack NuGet ref — 1.2.0)
//   • a built static export at `out/` (run `pnpm shell:export` first; `pnpm shell:pack` chains both)
//
// The shell serves the Next static export from an `out/` folder beside the exe (see MainForm.ResolveOutDir),
// so we publish the exe, copy `out/` in next to it, then pack the whole folder.
//
// Usage:  node scripts/build-shell.mjs [version]   (version defaults to package.json "version")

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = process.cwd()
const VPK_VERSION = "1.2.0" // MUST match the Velopack NuGet ref in ShellHost.csproj
const VERSION = String(process.argv[2] || JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version)
  .replace(/^v/, "")

const shellDir = path.join(root, "native", "shell-host")
const publishDir = path.join(shellDir, "publish")
const outExport = path.join(root, "out")
const releaseDir = path.join(root, "release-shell")

if (!existsSync(path.join(outExport, "index.html"))) {
  console.error("[shell] Missing static export at out/index.html. Run `pnpm shell:export` first.")
  process.exit(1)
}

// Windows resolves `dotnet`/`vpk` through the shell; keep shell:true only there (POSIX finds them on PATH).
const win = process.platform === "win32"
function run(cmd, args, cwd) {
  console.log(`[shell] ${cmd} ${args.join(" ")}`)
  execFileSync(cmd, args, { stdio: "inherit", cwd: cwd || root, shell: win })
}

// Resolve the `vpk` CLI, installing it as a .NET global tool if absent. We ALWAYS return an absolute
// path to the binary rather than trusting PATH: a freshly-installed global tool lands in
// ~/.dotnet/tools, which the CURRENT shell won't have on PATH yet (the #1 reason `pnpm shell:pack`
// fails right after installing). CI installs vpk in its own step, so this is mostly for local runs.
function ensureVpk() {
  const toolsDir = path.join(os.homedir(), ".dotnet", "tools")
  const binName = win ? "vpk.exe" : "vpk"
  const toolPath = path.join(toolsDir, binName)

  const works = (bin) => {
    try {
      execFileSync(bin, ["--help"], { stdio: "ignore", shell: win })
      return true
    } catch {
      return false
    }
  }

  if (existsSync(toolPath) && works(toolPath)) return toolPath
  if (works("vpk")) return "vpk" // already on PATH (e.g. CI)

  console.log(`[shell] vpk not found — installing Velopack CLI ${VPK_VERSION} as a global tool…`)
  try {
    execFileSync("dotnet", ["tool", "install", "--global", "vpk", "--version", VPK_VERSION], {
      stdio: "inherit",
      shell: win,
    })
  } catch {
    // Most likely already installed at a different version → move it to the pinned one.
    execFileSync("dotnet", ["tool", "update", "--global", "vpk", "--version", VPK_VERSION], {
      stdio: "inherit",
      shell: win,
    })
  }

  if (existsSync(toolPath)) return toolPath
  if (works("vpk")) return "vpk"
  console.error(
    "[shell] Installed vpk but can't locate it. Open a NEW terminal (so ~/.dotnet/tools is on PATH) and re-run `pnpm shell:pack`.",
  )
  process.exit(1)
}

// 1. Clean prior outputs so a stale exe/nupkg can't sneak into the package.
rmSync(publishDir, { recursive: true, force: true })
rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(releaseDir, { recursive: true })

// 2. Publish the shell: self-contained single-file (no .NET install on the Surface), version baked into
//    AssemblyInformationalVersion so window.zero.appVersion matches the Velopack package version.
run(
  "dotnet",
  [
    "publish",
    "ShellHost.csproj",
    "-c",
    "Release",
    "-r",
    "win-x64",
    "-p:ShellPublish=true",
    `-p:Version=${VERSION}`,
    "-o",
    publishDir,
  ],
  shellDir,
)

// 3. Bundle the static export beside the exe (MainForm looks for `out/` next to the binary).
cpSync(outExport, path.join(publishDir, "out"), { recursive: true })

// 4. Velopack pack → installer + feed. Zero.exe is the single-file publish output (AssemblyName=Zero).
//    Resolve (and if needed install) the vpk CLI first, invoking it by absolute path.
const vpk = ensureVpk()
run(vpk, [
  "pack",
  "--packId",
  "Zero",
  "--packTitle",
  "Zero",
  "--packVersion",
  VERSION,
  "--packDir",
  publishDir,
  "--mainExe",
  "Zero.exe",
  "--outputDir",
  releaseDir,
])

console.log(`[shell] Velopack feed ready in release-shell/ (v${VERSION})`)
