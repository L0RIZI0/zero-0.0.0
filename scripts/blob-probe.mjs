import { put } from "@vercel/blob"

// One-off: discover the store's stable public base host so we can hardcode the
// electron-updater feed URL. Safe to delete after.
const blob = await put("updates/_probe.txt", "zero-updater-probe", {
  access: "public",
  allowOverwrite: true,
  addRandomSuffix: false,
})
const u = new URL(blob.url)
console.log("PUBLIC_URL=" + blob.url)
console.log("PUBLIC_BASE=" + u.origin)
