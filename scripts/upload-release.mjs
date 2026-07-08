// Uploads the electron-builder Windows artifacts to the PUBLIC Vercel Blob "update
// feed" that the app's electron-updater polls. Run in CI after `electron-builder`
// (see .github/workflows/release.yml). Token-free downloads on the client require a
// PUBLIC blob store, so this uploads with `access: "public"`.
//
// The upload keys MUST live under the same path segment that the electron-builder
// `publish.url` points at (see package.json → build.publish.url). Both are the
// PUBLIC store's `/updates` prefix, kept in sync via FEED_URL below. electron-updater
// fetches <feed>/latest.yml, reads the installer + .blockmap filenames from it, and
// downloads them from the same folder.
//
// Env:
//   BLOB_READ_WRITE_TOKEN  – write token for the PUBLIC store (GitHub secret)

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { put, list, del } from "@vercel/blob"

const RELEASE_DIR = path.resolve("release")

// PUBLIC, stable, non-secret. MUST match package.json → build.publish.url.
const FEED_URL = "https://nxge4raka52ini1u.public.blob.vercel-storage.com/updates"

function feedPrefix() {
  // The path portion of the feed URL is the blob key prefix (strip leading slash).
  return new URL(FEED_URL).pathname.replace(/^\/+/, "").replace(/\/+$/, "") // -> "updates"
}

// Only these artifacts belong in the feed: the update manifest, the NSIS installer,
// and its differential-download blockmap. Everything else in release/ is ignored.
function shouldUpload(name) {
  return name === "latest.yml" || name.endsWith(".exe") || name.endsWith(".exe.blockmap")
}

// Before uploading, delete every artifact already in the feed that ISN'T part of
// THIS release. Each version ships a stable-named ~150MB installer (Zero-Setup-
// <version>.exe) + blockmap; without pruning they pile up until the PUBLIC store
// blows past the 1GB Hobby-plan quota and `put` starts rejecting — which is exactly
// what silently broke v0.2.6/2.7 publishing (build OK, upload "Storage quota
// exceeded"). electron-updater only needs the CURRENT version in the feed: the
// differential downloader diffs the new blockmap against the file already on the
// user's disk, not against old feed entries. So keeping only the latest is safe and
// keeps the store at ~150MB. Pruning runs FIRST so it frees space before the `put`s.
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
      console.log(`[release] pruned stale ${b.pathname} (${((b.size || 0) / 1e6).toFixed(1)}MB)`)
    }
    cursor = hasMore ? next : undefined
  } while (cursor)
  if (removed === 0) console.log("[release] no stale artifacts to prune")
  else console.log(`[release] pruned ${removed} stale artifact(s), freed ${(freedBytes / 1e6).toFixed(1)}MB`)
}

async function main() {
  const prefix = feedPrefix()
  const entries = await readdir(RELEASE_DIR)
  const targets = entries.filter(shouldUpload)
  if (targets.length === 0) {
    throw new Error(`No release artifacts found in ${RELEASE_DIR}`)
  }

  // Free the store of prior versions before uploading this one (self-healing quota).
  const keepKeys = new Set(targets.map((name) => `${prefix}/${name}`))
  await pruneStale(prefix, keepKeys)

  for (const name of targets) {
    const body = await readFile(path.join(RELEASE_DIR, name))
    const key = `${prefix}/${name}`
    const { url } = await put(key, body, {
      access: "public",
      addRandomSuffix: false, // stable, predictable URLs the updater can resolve
      allowOverwrite: true, // latest.yml (and re-runs) must overwrite
      contentType: name.endsWith(".yml") ? "text/yaml" : "application/octet-stream",
    })
    console.log(`[release] uploaded ${name} -> ${url}`)
  }
  console.log(`[release] feed ready at ${FEED_URL}/latest.yml`)
}

main().catch((err) => {
  console.error("[release] upload failed:", err?.message || err)
  process.exit(1)
})
