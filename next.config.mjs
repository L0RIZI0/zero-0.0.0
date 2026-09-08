// Set when packaging the desktop (Electron) build — see `electron:build` script.
// Only then do we emit a static export into `out/`; the normal web build and the
// v0 preview are completely unaffected.
const isElectron = process.env.BUILD_TARGET === "electron"

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // `@zero/dayline` (Grok's dayline engine repo) ships raw TypeScript with no build output, so Next
  // must compile it just like in-tree source. Installed via git tag: github:L0RIZI0/zero-dayline#vX.Y.Z.
  transpilePackages: ["@zero/dayline"],
  images: {
    unoptimized: true,
  },
  // Expose the build target to CLIENT code (inlined at build time). Used to keep
  // web-preview-only affordances — e.g. the seeded `/matrix-interactions` resource — OUT
  // of the packaged desktop export, whose shell only ever mounts `/`.
  env: {
    NEXT_PUBLIC_ZERO_ELECTRON: isElectron ? "1" : "",
  },
  // The packaged shell serves this export from the virtual-host ROOT (https://zero.local/ mapped to
  // `out/` via SetVirtualHostNameToFolderMapping — the old app:// protocol is gone). Use a ROOT-ABSOLUTE
  // asset prefix so `/_next/…` resolves identically at every route depth. Relative `./` only worked for
  // the root document (`/index.html`); a subpath route like the M3 menu overlay (`/menu/index.html`)
  // resolved `./_next/` to `/menu/_next/` → 404, so its runtime chunks never loaded and React never
  // hydrated (the "card never rendered" bug on v0.2.369). `output: 'export'` requires the app to be
  // client-renderable end-to-end — Zero already is (client components + local persistence, no server
  // routes), which is exactly why it ports cleanly.
  ...(isElectron ? { output: "export", assetPrefix: "/", trailingSlash: true } : {}),
  // The v0 preview is served from a cross-origin host (e.g.
  // *.vusercontent.net). Next.js 16 blocks cross-origin access to dev
  // resources (the webpack/HMR client runtime) by default, which prevents the
  // client bundle from loading in the preview iframe — the SSR HTML paints but
  // React never hydrates, so nothing is clickable (only CSS :hover works).
  // Allowing these origins lets the dev runtime load so hydration completes.
  allowedDevOrigins: ["*.vusercontent.net", "*.v0.dev", "*.v0.app"],
}

export default nextConfig
