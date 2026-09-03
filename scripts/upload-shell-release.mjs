// Uploads the Velopack SHELL artifacts (release-shell/, produced by scripts/build-shell.mjs) to the
// PUBLIC Vercel Blob "updates-shell" feed that the WebView2 shell's Velopack UpdateManager polls.
// Run in CI after `pnpm shell:pack` (see .github/workflows/release.yml).
//
// SEPARATE feed prefix from the Electron app's (/updates): the two shells ship side by side until the
// Electron cutover, and each release script prunes ONLY its own prefix — so they never clobber each
// other's feed. Token-free client downloads require a PUBLIC store, so we upload with access:"public".
//
// UpdateManager("<FEED_URL>") resolves to a SimpleWebSource and reads <FEED_URL>/releases.win.json, then
// pulls the .nupkg named in it from the same folder. We therefore upload the whole feed: the manifest
// json(s), the .nupkg(s), and the Setup.exe (the latter only for humans doing the first install).
//
// Env:  BLOB_READ_WRITE_TOKEN – write token for the PUBLIC store (GitHub secret)

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { put, list, del } from "@vercel/blob"

const RELEASE_DIR = path.resolve("release-shell")

// PUBLIC, stable, non-secret. MUST match UpdateService.cs → FeedUrl.
const FEED_URL = "https://nxge4raka52ini1u.public.blob.vercel-storage.com/updates-shell"

function feedPrefix() {
  return new URL(FEED_URL).pathname.replace(/^\/+/, "").replace(/\/+$/, "") // -> "updates-shell"
}

// vpk emits: releases.win.json + assets.win.json (feed manifests), Zero-<ver>-full.nupkg (+ delta if a
// prior nupkg was present), and Zero-win-Setup.exe. Ship all of those; skip the big Portable .zip and
// any .pdb — the updater never needs them and they'd waste the PUBLIC store's quota.
function shouldUpload(name) {
  if (name.endsWith(".zip") || name.endsWith(".pdb")) return false
  return name.endsWith(".json") || name.endsWith(".nupkg") || name.endsWith(".exe")
}

// Before uploading, delete everything already in the feed that ISN'T part of THIS release. The "always
// latest" model: the client's Velopack applies the newest full package directly, so we only ever keep the
// current version's files. This keeps the PUBLIC store well under the 1GB Hobby quota (see the Electron
// upload script for the war story on quota exhaustion silently breaking publishing).
async function pruneStale(prefix, keepKeys) {
  let cursor
  let removed = 0
  let freedBytes = 0
  do {
    const { blobs, cursor: next, hasMore } = await list({ prefix: `${prefix}/`, cursor })
    for (const b of blobs) {
      if (keepKeys.has(b.pathname)) continue
      await del(b.url)
      removed++
      freedBytes += b.size || 0
      console.log(`[shell-release] pruned stale ${b.pathname} (${((b.size || 0) / 1e6).toFixed(1)}MB)`)
    }
    cursor = hasMore ? next : undefined
  } while (cursor)
  if (removed === 0) console.log("[shell-release] no stale artifacts to prune")
  else console.log(`[shell-release] pruned ${removed} stale artifact(s), freed ${(freedBytes / 1e6).toFixed(1)}MB`)
}

// Blob quota accounting is eventually consistent: a `put` right after `del` can still see the old usage
// and throw "Storage quota exceeded". Retry with backoff so the upload lands once deletes propagate.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function putWithRetry(key, body, opts, attempts = 6) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await put(key, body, opts)
    } catch (err) {
      lastErr = err
      const quota = /quota exceeded/i.test(err?.message || "")
      if (!quota || i === attempts - 1) throw err
      const waitMs = 3000 * (i + 1)
      console.log(`[shell-release] quota not yet freed (attempt ${i + 1}/${attempts}); waiting ${waitMs / 1000}s…`)
      await sleep(waitMs)
    }
  }
  throw lastErr
}

async function main() {
  const prefix = feedPrefix()
  const entries = await readdir(RELEASE_DIR)
  const targets = entries.filter(shouldUpload)
  if (targets.length === 0) {
    throw new Error(`No shell release artifacts found in ${RELEASE_DIR}`)
  }

  const keepKeys = new Set(targets.map((name) => `${prefix}/${name}`))
  await pruneStale(prefix, keepKeys)

  for (const name of targets) {
    const body = await readFile(path.join(RELEASE_DIR, name))
    const key = `${prefix}/${name}`
    const { url } = await putWithRetry(key, body, {
      access: "public",
      addRandomSuffix: false, // stable URLs the updater resolves from releases.win.json
      allowOverwrite: true, // manifests + re-runs must overwrite
      contentType: name.endsWith(".json") ? "application/json" : "application/octet-stream",
    })
    console.log(`[shell-release] uploaded ${name} -> ${url}`)
  }
  console.log(`[shell-release] feed ready at ${FEED_URL}/releases.win.json`)
}

main().catch((err) => {
  console.error("[shell-release] upload failed:", err?.message || err)
  process.exit(1)
})
