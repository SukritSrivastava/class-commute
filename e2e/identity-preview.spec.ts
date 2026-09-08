import { test } from "@playwright/test";

/**
 * Not a test — a look at the foundation.
 *
 * Renders the palette, the type roles and the texture on a scratch page so the
 * tokens can be seen together before any page is built on them. Skipped unless
 * asked for:
 *
 *   IDENTITY_PREVIEW=1 npx playwright test e2e/identity-preview.spec.ts --project=desktop
 */
test.skip(!process.env.IDENTITY_PREVIEW, "set IDENTITY_PREVIEW=1 to render");

test("render the token sheet", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    // Appended to <body>, outside React's root container — mutating React's own
    // tree just gets reverted on the next render. The texture layers, fonts and
    // tokens underneath are all the live ones.
    const host = document.createElement("div");
    host.style.cssText =
      "position:absolute;inset:0;z-index:20;background:var(--color-night)";
    document.body.appendChild(host);
    host.innerHTML = `
      <div style="padding:56px 40px;max-width:1080px;margin:0 auto">
        <p style="font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;
                  text-transform:uppercase;color:var(--color-ink-dim);margin:0 0 28px">
          Class Commute — foundation
        </p>

        <h1 class="type-display" style="font-size:112px;margin:0 0 8px">
          07:41 <span class="text-sunset">TO CLASS</span>
        </h1>
        <p style="font-family:var(--font-sans);color:var(--color-ink-muted);
                  margin:0 0 48px;font-size:15px">
          Display / Archivo 800 condensed · UI / Geist · Numeric / Geist Mono
        </p>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:40px">
          ${[
            ["night", "#0A0510"],
            ["night-2", "#150B20"],
            ["night-3", "#1F1030"],
            ["hairline", "rgba(255,255,255,.08)"],
            ["magenta", "#FF2D78"],
            ["orange", "#FF7A29"],
            ["gold", "#FFC24B"],
            ["cyan", "#21D4E0"],
          ]
            .map(
              ([name, value]) => `
            <div style="border:1px solid var(--color-hairline);border-radius:14px;overflow:hidden">
              <div style="height:72px;background:${value}"></div>
              <div style="padding:10px 12px;background:var(--color-night-2)">
                <div style="font-family:var(--font-sans);font-size:13px">${name}</div>
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--color-ink-dim)">${value}</div>
              </div>
            </div>`
            )
            .join("")}
        </div>

        <div style="height:64px;border-radius:14px;margin-bottom:40px;background:var(--gradient-sunset)"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div style="background:var(--color-night-2);border:1px solid var(--color-hairline);
                      border-radius:18px;padding:22px">
            <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;
                        text-transform:uppercase;color:var(--color-gold);margin-bottom:14px">
              Best pick
            </div>
            <div class="type-time" style="font-size:76px">09:17</div>
            <div style="font-family:var(--font-sans);color:var(--color-ink-muted);
                        font-size:14px;margin-top:10px">
              Virar — Churchgate Local ·
              <span class="type-numeric" style="color:var(--color-ink)">90270</span>
            </div>
          </div>

          <div style="background:var(--color-night-2);border:1px solid var(--color-hairline);
                      border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:12px">
            <div style="font-family:var(--font-sans);color:var(--color-ink);font-size:15px">Primary text — ink</div>
            <div style="font-family:var(--font-sans);color:var(--color-ink-muted);font-size:15px">Secondary — ink-muted</div>
            <div style="font-family:var(--font-sans);color:var(--color-ink-dim);font-size:15px">Tertiary — ink-dim</div>
            <button data-press style="margin-top:auto;height:52px;border:0;border-radius:12px;
                    background:var(--color-magenta);color:var(--color-on-accent);
                    font-family:var(--font-sans);font-weight:600;font-size:16px;cursor:pointer">
              Find my train
            </button>
          </div>
        </div>
      </div>`;
  });

  await page.setViewportSize({ width: 1180, height: 1000 });
  await page.screenshot({ path: "identity-preview.png", fullPage: true });
});
