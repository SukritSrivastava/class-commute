import { expect, test } from "@playwright/test";

/**
 * Guards the visual identity at the level it is actually defined: tokens,
 * texture, and the rule that motion never gates information.
 *
 * These are cheap checks of things that break silently. A renamed token, a
 * texture layer that starts eating clicks, or a Lenis instance that survives
 * `prefers-reduced-motion` are all invisible in a screenshot and obvious here.
 */

const TOKENS: Record<string, string> = {
  "--color-night": "#0a0510",
  "--color-night-2": "#150b20",
  "--color-night-3": "#1f1030",
  "--color-magenta": "#ff2d78",
  "--color-orange": "#ff7a29",
  "--color-gold": "#ffc24b",
  "--color-cyan": "#21d4e0",
  "--color-violet": "#7b2ff7",
  "--ease-signature": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--duration-ui": "200ms",
  "--duration-content": "600ms",
};

test("the palette and motion tokens reach the browser", async ({ page }) => {
  await page.goto("/");

  const resolved = await page.evaluate((names) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((n) => [n, style.getPropertyValue(n).trim()])
    );
  }, Object.keys(TOKENS));

  // The minifier rewrites values without changing them: "0.16" ships as ".16"
  // and "200ms" as ".2s". Compare on a canonical form so this asserts the
  // design decision rather than a build detail.
  const normalise = (value: string) => {
    const v = value.toLowerCase().replace(/\s+/g, " ").trim();

    const duration = /^(\d*\.?\d+)(ms|s)$/.exec(v);
    if (duration) {
      return `${parseFloat(duration[1]) * (duration[2] === "s" ? 1000 : 1)}ms`;
    }

    return v.replace(/(^|[^\d.])0\./g, "$1.");
  };

  for (const [name, expected] of Object.entries(TOKENS)) {
    expect(normalise(resolved[name]), name).toBe(normalise(expected));
  }
});

test("the page is painted on night, not left transparent", async ({ page }) => {
  await page.goto("/");

  // A transparent body borrows the host's ground and the palette falls apart.
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(10, 5, 16)"
  );
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("texture layers are present and completely inert", async ({ page }) => {
  await page.goto("/");

  for (const selector of [".texture-bloom", ".texture-grain"]) {
    const layer = page.locator(selector);
    await expect(layer).toHaveCount(1);
    await expect(layer).toHaveCSS("position", "fixed");
    // They cover the viewport; if they ever caught a pointer the form beneath
    // would become untappable, which on this app means unusable.
    await expect(layer).toHaveCSS("pointer-events", "none");
  }

  await expect(page.locator(".texture-grain")).toHaveCSS(
    "mix-blend-mode",
    "overlay"
  );

  // The one control that matters is still reachable through both layers.
  await page.getByRole("combobox", { name: "Home station" }).click();
  await expect(page.getByRole("combobox", { name: "Home station" })).toBeFocused();
});

test("momentum scrolling is on by default", async ({ page }) => {
  await page.goto("/");
  // Lenis stamps this class on <html> itself once it is driving the scroll.
  await expect(page.locator("html")).toHaveClass(/lenis/);
});

test.describe("with prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("Lenis never starts, and content is still there", async ({ page }) => {
    await page.goto("/");

    // Off, not shortened: native scrolling is the only correct behaviour here.
    await expect(page.locator("html")).not.toHaveClass(/lenis/);

    // And the app is fully usable, which is the actual point.
    await expect(
      page.getByRole("heading", { level: 1, name: "Class Commute" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Find my train" })
    ).toBeVisible();
  });
});

test("nothing is hidden behind a reveal on first paint", async ({ page }) => {
  await page.goto("/");

  // The answer must be reachable in one screen and one tap. Anything left in
  // the hidden state after load would be information gated behind motion.
  await expect(page.locator('[data-reveal="hidden"]')).toHaveCount(0);
});
