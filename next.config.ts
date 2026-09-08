import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  /* config options here */
};

// `@next/bundle-analyzer` is a webpack plugin, and Next 16 builds with
// Turbopack by default — so `npm run analyze` passes `--webpack` to make this
// take effect. The report it produces is a close proxy, not the exact bytes
// Vercel ships; read the baseline number off a plain `next build`.
export default withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  // Write the reports to .next/analyze/ instead of spawning browser tabs, so
  // the script is safe to run unattended.
  openAnalyzer: false,
})(nextConfig);
