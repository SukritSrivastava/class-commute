import { serwist } from "@serwist/next/config";

/**
 * Serwist in **configurator mode**, run by `@serwist/cli` after `next build`.
 *
 * ## Why not the usual `withSerwistInit` plugin
 *
 * `@serwist/next`'s plugin form hooks in exclusively through Next's `webpack()`
 * config function, and its own source prints:
 *
 *   "WARNING: You are using '@serwist/next' with `next dev --turbopack`, but it
 *    doesn't support Turbopack."
 *
 * Next 16 builds with Turbopack by default, so the plugin would silently never
 * run. The alternatives it offers are to force webpack (giving up Turbopack's
 * build), to use the experimental `@serwist/turbopack`, or this — configurator
 * mode, which is bundler-agnostic because it reads the *finished* `.next`
 * output rather than participating in the build. That keeps Serwist, keeps
 * Next 16, keeps Turbopack, and keeps all three on released versions.
 *
 * Wired into `npm run build` as a second step, so `next build && serwist build`
 * is what Vercel runs too.
 */
export default await serwist({
  // Source and destination. `public/sw.js` puts the worker at the origin root,
  // which is what gives it a scope covering the whole app.
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",

  // What lands in the precache. The defaults cover `.next/static/**` (every JS
  // and CSS chunk, so the bundled station list rides along inside its chunk)
  // and `public/**` (icons, the manifest). `precachePrerendered` adds the
  // prerendered HTML for `/`, which is the app shell.
  globDirectory: ".",
  precachePrerendered: true,

  globIgnores: [
    // The install icons are ~240KB and the running app never renders them —
    // they exist for the OS installer, which fetches them while online, at
    // install time, from the manifest. Precaching them would spend a quarter of
    // a megabyte of the user's data on the exact bad connection this whole
    // phase is about, to make something available offline that is only ever
    // needed online.
    "public/icons/**",
  ],

  // The station bundle is ~5KB of JSON inside a JS chunk; nothing here is
  // large, but an explicit ceiling stops a stray asset from bloating the
  // first-visit download.
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
});
