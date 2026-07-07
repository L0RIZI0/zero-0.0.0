// Uploads the electron-builder Windows artifacts to the PUBLIC Vercel Blob "update
// feed" that the app's electron-updater polls. Run in CI after `electron-builder`
// (see .github/workflows/release.yml). Token-free downloads on the client require a
// PUBLIC blob store, so this uploads with `access: "public"`.
//
// The upload keys MUST live under the same path segment that ZERO_UPDATE_FEED_URL
// points at (e.g. feed = https://<store>.public.blob.vercel-storage.com/updates ⇒
// keys are updates/<file>). electron-updater fetches <feed>/latest.yml, reads the
// installer + .blockmap filenames from it, and downloads them from the same folder.
//
// Env:
//   BLOB_READ_WRITE_TOKEN  – write token for the PUBLIC store (GitHub secret)
//   ZERO_UPDATE_FEED_URL   – full feed URL incl. the path prefix (GitHub variable)

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { put } from "@vercel/blob"

const RELEASE_DIR = path.resolve("release")

function feedPrefix() {
  const feed = process.env.ZERO_UPDATE_FEED_URL
  if (!feed) throw new Error("ZERO_UPDATE_FEED_URL is not set")
  // The path portion of the feed URL is the blob key prefix (strip leading slash).
  const prefix = new URL(feed).pathname.replace(/^\/+/, "").replace(/\/+$/, "")
  return prefix // e.g. "updates"
}

// Only these artifacts belong in the feed: the update manifest, the NSIS installer,
// and its differential-download blockmap. Everything else in release/ is ignored.
function shouldUpload(name) {
  return name === "latest.yml" || name.endsWith(".exe") || name.endsWith(".exe.blockmap")
}

async function main() {
  const prefix = feedPrefix()
  const entries = await readdir(RELEASE_DIR)
  const targets = entries.filter(shouldUpload)
  if (targets.length === 0) {
    throw new Error(`No release artifacts found in ${RELEASE_DIR}`)
  }

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
  console.log(`[release] feed ready at ${process.env.ZERO_UPDATE_FEED_URL}/latest.yml`)
}

main().catch((err) => {
  console.error("[release] upload failed:", err?.message || err)
  process.exit(1)
})
