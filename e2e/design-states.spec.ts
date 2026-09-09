import { expect, test, type Page } from "@playwright/test";

/**
 * Renders every state of the interface to `design-shots/`, at phone and desktop
 * widths, so the identity can be reviewed as a set rather than one screen at a
 * time.
 *
 * Not a test — a contact sheet. Skipped unless asked for, because two of the
 * states need a live API key:
 *
 *   RAILRADAR_ACCEPTANCE=1 PORT=3123 npx playwright test e2e/design-states.spec.ts
 */
test.skip(!process.env.RAILRADAR_ACCEPTANCE, "set RAILRADAR_ACCEPTANCE=1 to render");

/**
 * Service workers are blocked for this run. `page.route` cannot intercept a
 * request the service worker makes on the page's behalf, so with the worker
 * active the artificially delayed response below sailed straight past it and
 * the "loading" shot captured a finished result. Blocking it makes every state
 * here deterministic; the offline state does not need the worker either,
 * because it never reloads — it goes offline and re-submits, which is answered
 * from IndexedDB.
 */
test.use({ serviceWorkers: "block" });

const WIDTHS = [
  { name: "375", width: 375, height: 900 },
  { name: "1280", width: 1280, height: 900 },
];

/**
 * A class late enough tonight that there is still something to find.
 *
 * This is the one thing here tied to the wall clock. A journey has to depart
 * after now and arrive a full buffer before this time, so past roughly 22:15
 * IST the last Borivali–Churchgate service that fits has already gone and the
 * three states below that need a live answer find nothing. Render the sheet
 * earlier in the day; the states that need no network are captured first, so
 * they come out either way.
 */
const CLASS_TIME = "23:59";

async function pick(page: Page, label: string, text: string) {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill("");
  await box.pressSequentially(text, { delay: 20 });
  await page.getByRole("option").first().click();
}

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(700); // let reveals settle
  // Next's dev-tools badge is a fixed circle in the bottom-left corner. It is
  // not part of the app and it sits on top of the alternatives at 375px, so it
  // is hidden for the contact sheet rather than reviewed as if it were design.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: `design-shots/${name}.png`, fullPage: true });
  console.log(`  ${name}.png`);
}

for (const size of WIDTHS) {
  test(`states at ${size.name}px`, async ({ page, context }, testInfo) => {
    // This file drives its own viewports, so letting the config's two projects
    // both pick it up renders every state twice and spends the quota twice for
    // an identical set of files.
    test.skip(
      testInfo.project.name !== "mobile",
      "renders its own widths; one project run covers the whole set"
    );

    await page.setViewportSize({ width: size.width, height: size.height });

    // --- empty ---------------------------------------------------------
    await page.goto("/");
    await shoot(page, `${size.name}-1-empty`);

    // --- loading -------------------------------------------------------
    // Held open deliberately so the journey-line sweep can be seen.
    await page.route("**/api/best-train**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      // The shot is taken long before this resolves and the next section
      // navigates away, which aborts the request underneath us. That is the
      // intended course of events here, not a failure.
      await route.continue().catch(() => {});
    });
    await pick(page, "From", "borivali");
    await pick(page, "To", "churchgate");
    await page.getByLabel("Class starts").fill(CLASS_TIME);
    await page.getByRole("button", { name: "Find my train" }).click();
    await page.waitForTimeout(900);
    await shoot(page, `${size.name}-2-loading`);
    await page.unroute("**/api/best-train**");

    // --- error: offline and never asked before -------------------------
    // Captured out of numerical order, deliberately. It needs no timetable at
    // all — only a route this device has never saved — so taking it here means
    // it still renders on a run where the live states below find nothing.
    await page.goto("/");
    await context.setOffline(true);
    await pick(page, "From", "thane");
    await pick(page, "To", "panvel");
    await page.getByLabel("Class starts").fill("09:00");
    await page.getByRole("button", { name: "Find my train" }).click();
    await expect(page.getByTestId("result-error")).toBeVisible({ timeout: 10_000 });
    await shoot(page, `${size.name}-6-error`);
    await context.setOffline(false);

    // --- direct result -------------------------------------------------
    await page.goto("/");
    await pick(page, "From", "borivali");
    await pick(page, "To", "churchgate");
    await page.getByLabel("Class starts").fill(CLASS_TIME);
    await page.getByRole("button", { name: "Find my train" }).click();
    await expect(page.getByText("Best pick")).toBeVisible({ timeout: 25_000 });
    await shoot(page, `${size.name}-3-direct`);

    // --- interchange result --------------------------------------------
    await page.goto("/");
    await pick(page, "From", "borivali");
    await pick(page, "To", "csmt");
    await page.getByLabel("Class starts").fill(CLASS_TIME);
    await page.getByRole("button", { name: "Find my train" }).click();
    await expect(page.getByText("Best pick")).toBeVisible({ timeout: 25_000 });
    await shoot(page, `${size.name}-4-interchange`);

    // --- saved answer, offline -----------------------------------------
    // No navigation: with the worker blocked there is no precache to load the
    // shell from, so the page stays put and simply re-asks the same question
    // with the network gone. That is answered from IndexedDB.
    await context.setOffline(true);
    await page.getByRole("button", { name: "Search again" }).click();
    await expect(page.getByTestId("cached-notice")).toBeVisible({ timeout: 10_000 });
    await shoot(page, `${size.name}-5-saved-offline`);
    await context.setOffline(false);

  });
}
