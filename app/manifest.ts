import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Installing matters more here than it does for most apps: an icon on the home
 * screen is what turns "open a browser, find the tab, wait for the page" into
 * one tap at 7:40am, and a standalone window drops the browser chrome that
 * otherwise eats a fifth of a phone screen.
 *
 * iOS does **not** read most of this. Safari needs `apple-touch-icon` and the
 * `apple-mobile-web-app-*` meta tags, which are in `app/layout.tsx`. Shipping
 * only a manifest gets you an installable app on Android and a bookmark with a
 * grey icon on iPhone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity, so a change of scope or start_url doesn't make Chrome
    // treat an already-installed app as a different one.
    id: "/",
    name: "Class Commute — catch the right Mumbai local",
    short_name: "Class Commute",
    description:
      "The latest Mumbai local that still gets you to class on time. Works offline on the platform.",

    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",

    // Both match --color-night. `theme_color` paints the status bar and the
    // window chrome; `background_color` is the splash screen while the app
    // boots, and a mismatch there shows as a white flash on every cold start.
    theme_color: "#0A0510",
    background_color: "#0A0510",

    lang: "en",
    dir: "ltr",
    categories: ["travel", "utilities", "navigation"],

    icons: [
      // `any` is used as-is — in a browser tab, a task switcher, a shortcut.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // `maskable` gets cropped to the launcher's shape, so the mark inside is
      // scaled down to stay within Android's inner-80% safe zone.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
