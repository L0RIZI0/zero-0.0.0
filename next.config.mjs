/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The v0 preview is served from a cross-origin host (e.g.
  // *.vusercontent.net). Next.js 16 blocks cross-origin access to dev
  // resources (the webpack/HMR client runtime) by default, which prevents the
  // client bundle from loading in the preview iframe — the SSR HTML paints but
  // React never hydrates, so nothing is clickable (only CSS :hover works).
  // Allowing these origins lets the dev runtime load so hydration completes.
  allowedDevOrigins: ["*.vusercontent.net", "*.v0.dev", "*.v0.app"],
}

export default nextConfig
