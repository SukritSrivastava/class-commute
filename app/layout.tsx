import type { Metadata, Viewport } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import SmoothScroll from "@/components/motion/SmoothScroll";
import OfflineBanner from "@/components/OfflineBanner";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import "./globals.css";

/**
 * DISPLAY — the hero and, above all, train times.
 *
 * Archivo variable carries both a weight and a width axis, so one file gives us
 * heavy *and* condensed rather than needing a separate Archivo Condensed. It is
 * the only font on the page doing aesthetic work, and it is used in maybe three
 * places; that ratio is the point.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

/** UI — everything that is read rather than looked at. */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

/** NUMERIC — anything that aligns in a column or ticks. Tabular by default. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Class Commute — catch the right Mumbai local",
  description:
    "Find the latest Mumbai local train that still gets you to college on time.",

  /**
   * iOS installability. Safari ignores the web app manifest for all of this —
   * without these tags an iPhone "Add to Home Screen" produces a bookmark with
   * a screenshot for an icon, opening in Safari with full chrome rather than as
   * a standalone app. Android reads `app/manifest.ts` instead.
   */
  appleWebApp: {
    capable: true,
    title: "Class Commute",
    // Draws the page under the status bar so the night background runs to the
    // top of the screen rather than sitting below a black bar.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Stops iOS turning station codes and times into tappable "phone numbers".
  formatDetection: { telephone: false },

  other: {
    /**
     * Next 16 emits only the standardised `mobile-web-app-capable`. Safari has
     * honoured that as a synonym since iOS 16.4, but below that it reads
     * *only* the apple-prefixed name — and without it "Add to Home Screen"
     * gives a bookmark that opens in Safari with full chrome instead of a
     * standalone app. Plenty of the phones this app is for are older than
     * March 2023, so both names ship.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  // Paints the browser chrome to match the page instead of leaving a white bar
  // above all this on mobile.
  themeColor: "#0A0510",
  colorScheme: "dark",
  // Installed on a phone with a notch, the page should reach the screen edges;
  // the safe-area insets are then respected in CSS rather than by letterboxing.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // `dark` is unconditional: this palette has no light counterpart, so the
      // variant is pinned on rather than following the system preference. See
      // the @custom-variant declaration in globals.css.
      className={`dark ${archivo.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col bg-night text-ink">
        {/* Texture sits behind everything and is inert: fixed, pointer-events
            none, no layout cost, no requests. */}
        <div aria-hidden className="texture-bloom" />
        <div aria-hidden className="texture-grain" />

        {/* Above the texture layers, which occupy z-index 0 and 1.
            The safe-area padding matters once installed: `viewport-fit=cover`
            plus a translucent status bar runs the night background to the very
            top of the screen, which is the point — but without these insets the
            first line of content would sit under the notch. */}
        <div className="relative z-10 flex min-h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <OfflineBanner />
          {children}
        </div>

        <SmoothScroll />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
