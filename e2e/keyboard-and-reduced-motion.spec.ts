import { expect, test, type Page } from "@playwright/test";

/**
 * The two acceptance checks a screenshot cannot make: driving the whole app
 * from the keyboard alone, and running it for someone who has asked their OS
 * for no motion.
 *
 * Both are answered against a stubbed `/api/best-train`. What is under test
 * here is the interface, not the timetable, and a real lookup would spend the
 * monthly quota every time the suite runs.
 */

const RESULT = {
  from: { code: "BVI", name: "Borivali" },
  to: { code: "CCG", name: "Churchgate" },
  journeyDay: "today",
  best: {
    kind: "direct",
    legs: [
      {
        trainNumber: "90968",
        trainName: "Virar - Churchgate Local",
        trainType: "local",
        fromCode: "BVI",
        fromName: "Borivali",
        departure: "23:40",
        toCode: "CCG",
        toName: "Churchgate",
        arrival: "00:27",
        pace: "fast",
      },
    ],
    departure: "23:40",
    arrival: "00:27",
    bufferRemainingMinutes: 32,
    totalMinutes: 47,
    pace: "fast",
  },
  alternatives: [] as unknown[],
};

/** "HH:MM" in Mumbai, `offsetMinutes` from now. The clock `lib/time` reads. */
function mumbaiClock(offsetMinutes: number): string {
  const at = new Date(Date.now() + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

async function stubResult(page: Page, departure?: string) {
  const body = departure
    ? { ...RESULT, best: { ...RESULT.best, departure } }
    : RESULT;
  await page.route("**/api/best-train**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  );
}

/**
 * Opens the app and waits until React has taken over.
 *
 * Everything below drives the page with raw key presses, and a keystroke that
 * lands before hydration is typed into markup React then replaces — the field
 * comes back empty and the list never opens. The Mumbai clock is the honest
 * signal: it renders a blank on the server, on purpose, and prints a time only
 * once the client is running.
 */
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByText(/\d{2}:\d{2} IST/)).toBeVisible();
}

/** What has focus, in the terms these tests care about. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { name: "<body>", ring: "", tag: "BODY" };
    const style = getComputedStyle(el);
    const labelFor = el.id
      ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      : null;
    const name =
      el.getAttribute("aria-label") ||
      labelFor?.textContent?.trim() ||
      el.textContent?.trim().slice(0, 40) ||
      el.tagName;
    return {
      name,
      ring: style.outlineStyle + " " + style.outlineWidth + " " + style.outlineColor,
      tag: el.tagName,
    };
  });
}

const CYAN_RING = "solid 2px rgb(33, 212, 224)";

/** WCAG relative luminance of an "rgb(r, g, b)" string. */
function luminance(colour: string): number {
  const [r, g, b] = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** What WCAG 1.4.11 asks of a control's state indicator. */
const NON_TEXT_CONTRAST = 3;

/** Opens the "From" list with the keyboard and puts an option in the active slot. */
async function openList(page: Page) {
  await page.getByRole("combobox", { name: "From" }).focus();
  await page.keyboard.type("bo");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true"
  );
}

test.describe("keyboard only", () => {
  test("every control is reachable in visual order, with the ring always on", async ({
    page,
  }) => {
    await stubResult(page);
    await open(page);
    await page.locator("body").click({ position: { x: 2, y: 2 } });

    // Chromium gives a time input four tab stops of its own — three editable
    // segments and the picker button — which the UA owns and draws itself, so
    // consecutive repeats are collapsed into the one entry the app contributes.
    const order: string[] = [];
    for (let i = 0; i < 13; i++) {
      await page.keyboard.press("Tab");
      const { name, ring, tag } = await focused(page);
      if (order[order.length - 1] !== name) order.push(name);

      // Every stop this app styles gets the one cyan treatment, and gets it on
      // the first frame — a ring that fades up from another colour is a ring
      // that is briefly the wrong one.
      if (!(tag === "INPUT" && name === "Class starts")) {
        expect(ring, 'focus ring on "' + name + '"').toBe(CYAN_RING);
      }
    }

    expect(order).toEqual([
      "From",
      "Swap home and college stations",
      "To",
      "Class starts",
      "Decrease buffer by 5 minutes",
      "Buffer",
      "Increase buffer by 5 minutes",
      "Today",
      "Tomorrow",
      "Find my train",
    ]);
  });

  test("the autocomplete opens, navigates, closes and commits without a mouse", async ({
    page,
  }) => {
    await stubResult(page);
    await open(page);

    const from = page.getByRole("combobox", { name: "From" });
    await page.keyboard.press("Tab");
    await expect(from).toBeFocused();

    // Typing opens it. Nothing is trapped inside, so Escape gets back out and
    // focus stays on the field rather than being thrown to the body.
    await page.keyboard.type("borivali");
    await expect(from).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await expect(from).toHaveAttribute("aria-activedescendant", /option-0$/);
    await page.keyboard.press("Escape");
    await expect(from).toHaveAttribute("aria-expanded", "false");
    await expect(from).toBeFocused();

    // ArrowDown reopens a closed list, and Enter commits the active option.
    await page.keyboard.press("ArrowDown");
    await expect(from).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(from).toHaveValue("Borivali");
    await expect(from).toHaveAttribute("aria-expanded", "false");
    await expect(from).toBeFocused();
  });

  test("the option under the arrow keys is unmistakable, not just tinted", async ({
    page,
  }) => {
    await stubResult(page);
    await open(page);
    await openList(page);

    const seen = await page.evaluate(() => {
      const options = Array.from(
        document.querySelectorAll('[role="option"]')
      ) as HTMLElement[];
      const active = options[0];
      const panel = active.closest("div") as HTMLElement;
      const style = getComputedStyle(active);
      return {
        // The list is driven by aria-activedescendant, so real focus stays on
        // the input and the browser draws nothing on the option itself. The
        // highlight is the entire signal, which is why it has to carry.
        domFocus: (document.activeElement as HTMLElement).getAttribute("role"),
        ring: style.outlineStyle + " " + style.outlineWidth + " " + style.outlineColor,
        ringColour: style.outlineColor,
        panelGround: getComputedStyle(panel).backgroundColor,
        inactiveRing: getComputedStyle(options[1]).outlineStyle,
      };
    });

    expect(seen.domFocus).toBe("combobox");
    expect(seen.ring).toBe(CYAN_RING);
    expect(seen.inactiveRing).toBe("none");
    expect(
      contrast(seen.ringColour, seen.panelGround)
    ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);

    // And it actually travels: the ring is on the second option after a step.
    await page.keyboard.press("ArrowDown");
    const rings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"]')).map(
        (o) => getComputedStyle(o).outlineStyle
      )
    );
    expect(rings).toEqual(["none", "solid", "none"]);
  });

  test("the swap button swaps the two stations from the keyboard", async ({
    page,
  }) => {
    await stubResult(page);
    await open(page);

    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });

    await from.focus();
    await page.keyboard.type("borivali");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("churchgate");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(from).toHaveValue("Borivali");
    await expect(to).toHaveValue("Churchgate");

    // Back up onto the swap control and press it, with no pointer involved.
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Swap home and college stations" })
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(from).toHaveValue("Churchgate");
    await expect(to).toHaveValue("Borivali");
    // The fields are controlled, not remounted, so focus survives the swap.
    await expect(
      page.getByRole("button", { name: "Swap home and college stations" })
    ).toBeFocused();
  });

  test("a journey can be planned and read end to end from the keyboard", async ({
    page,
  }) => {
    await stubResult(page);
    await open(page);

    await page.keyboard.press("Tab");
    await page.keyboard.type("borivali");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await page.keyboard.press("Tab"); // swap
    await page.keyboard.press("Tab"); // To
    await page.keyboard.type("churchgate");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await page.getByLabel("Class starts").focus();
    await page.keyboard.type("1159PM");

    // Submitted from a field with Enter, the way anyone filling a form does it.
    await page.getByRole("combobox", { name: "To" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Best pick")).toBeVisible();

    // The collapsed form's controls are the last stops, in the order they are
    // drawn — including the one that brings the time and buffer back. Waited
    // for rather than raced: the time and buffer are still in the DOM, and so
    // still focusable, for the 200ms their exit transition takes.
    await expect(page.getByLabel("Buffer", { exact: true })).toBeHidden();
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const after: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      after.push((await focused(page)).name);
    }
    expect(after).toEqual([
      "From",
      "Swap home and college stations",
      "To",
      "Search again",
      "Change time or buffer",
    ]);

    // And that last one actually works from the keyboard.
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Buffer", { exact: true })).toBeVisible();
  });
});

test.describe("with prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("Lenis is not running at all, and native scrolling is untouched", async ({
    page,
  }) => {
    await open(page);

    // Lenis stamps these on <html> while it is driving the scroll. None of them
    // is here: it was never constructed, rather than constructed and hurried.
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/lenis/);
    await expect(html).not.toHaveClass(/lenis-smooth/);
    await expect(html).not.toHaveClass(/lenis-stopped/);

    // The tell that it is genuinely absent rather than merely fast: Lenis
    // cancels the browser's own scrolling and re-drives it from a rAF loop, so
    // under it a jump is interpolated instead of landing on the same frame.
    const landed = await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "4000px";
      document.body.appendChild(spacer);
      void document.body.offsetHeight; // flush layout before asking to scroll
      window.scrollTo(0, 1200);
      return window.scrollY;
    });
    expect(landed).toBe(1200);
  });

  test("the app is fully usable and nothing is left hidden", async ({ page }) => {
    await stubResult(page);
    await open(page);

    await expect(page.locator('[data-reveal="hidden"]')).toHaveCount(0);

    await page.getByRole("combobox", { name: "From" }).fill("borivali");
    await page.getByRole("option").first().click();
    await page.getByRole("combobox", { name: "To" }).fill("churchgate");
    await page.getByRole("option").first().click();
    await page.getByLabel("Class starts").fill("23:59");
    await page.getByRole("button", { name: "Find my train" }).click();

    await expect(page.getByText("Best pick")).toBeVisible();
    await expect(page.locator('[data-reveal="hidden"]')).toHaveCount(0);
    // The answer is opaque, not mid-fade and not stuck at zero.
    await expect(page.locator("article").first()).toHaveCSS("opacity", "1");
  });

  test("the journey-line sweep does not animate", async ({ page }) => {
    // Held open so the sweep is on screen while it is inspected.
    await page.route("**/api/best-train**", async (route) => {
      await new Promise((r) => setTimeout(r, 5_000));
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(RESULT),
        })
        .catch(() => {});
    });
    await open(page);

    await page.getByRole("combobox", { name: "From" }).fill("borivali");
    await page.getByRole("option").first().click();
    await page.getByRole("combobox", { name: "To" }).fill("churchgate");
    await page.getByRole("option").first().click();
    await page.getByLabel("Class starts").fill("23:59");
    await page.getByRole("button", { name: "Find my train" }).click();

    const sweep = page.locator(".journey-line-sweep");
    await expect(sweep).toBeVisible();

    const state = await sweep.evaluate((el) => ({
      name: getComputedStyle(el).animationName,
      running: el.getAnimations().length,
      opacity: getComputedStyle(el).opacity,
    }));

    // Stopped, not sped up: no animation is running on it at all. It stays as a
    // static gradient filling the line, so the rail still reads as busy — the
    // information survives, only the travel is gone.
    expect(state.name).toBe("none");
    expect(state.running).toBe(0);
    expect(Number(state.opacity)).toBeGreaterThan(0);

    // And it genuinely holds still.
    const first = await sweep.boundingBox();
    await page.waitForTimeout(700);
    const second = await sweep.boundingBox();
    expect(second!.y).toBe(first!.y);
  });

  test("the countdown still ticks — it is data changing, not decoration", async ({
    page,
  }) => {
    // Under a minute out, so the label counts in seconds and a change shows
    // inside the test rather than a minute later. Started early enough in the
    // minute that it cannot cross zero while the two samples are taken.
    await expect
      .poll(() => new Date().getSeconds() < 40, { timeout: 60_000 })
      .toBe(true);

    await stubResult(page, mumbaiClock(1));
    await page.goto("/");

    await page.getByRole("combobox", { name: "From" }).fill("borivali");
    await page.getByRole("option").first().click();
    await page.getByRole("combobox", { name: "To" }).fill("churchgate");
    await page.getByRole("option").first().click();
    await page.getByLabel("Class starts").fill("23:59");
    await page.getByRole("button", { name: "Find my train" }).click();

    const countdown = page.getByText(/Leaves in/);
    await expect(countdown).toBeVisible();

    const first = await countdown.textContent();
    expect(first).toMatch(/^Leaves in \d+s$/);

    await page.waitForTimeout(3_000);

    const second = await countdown.textContent();
    expect(second).toMatch(/^Leaves in \d+s$/);
    expect(Number(second!.match(/\d+/)![0])).toBeLessThan(
      Number(first!.match(/\d+/)![0])
    );
  });
});

/**
 * The control for the reduced-motion sweep check above.
 *
 * "It does not animate" is only evidence if it animates the rest of the time —
 * otherwise a sweep that had quietly stopped rendering would pass. This is the
 * same element, on the same screen, with the preference left alone.
 */
test("with motion allowed, the journey line really does sweep", async ({ page }) => {
  await page.route("**/api/best-train**", async (route) => {
    await new Promise((r) => setTimeout(r, 5_000));
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(RESULT),
      })
      .catch(() => {});
  });
  await open(page);

  await page.getByRole("combobox", { name: "From" }).fill("borivali");
  await page.getByRole("option").first().click();
  await page.getByRole("combobox", { name: "To" }).fill("churchgate");
  await page.getByRole("option").first().click();
  await page.getByLabel("Class starts").fill("23:59");
  await page.getByRole("button", { name: "Find my train" }).click();

  const sweep = page.locator(".journey-line-sweep");
  await expect(sweep).toBeVisible();

  const state = await sweep.evaluate((el) => ({
    name: getComputedStyle(el).animationName,
    running: el.getAnimations().length,
  }));
  expect(state.name).toBe("journey-sweep");
  expect(state.running).toBe(1);
});
