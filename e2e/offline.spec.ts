import { expect, test, type Page } from "@playwright/test";

/**
 * The acceptance test for this phase, run against a production build with the
 * real service worker:
 *
 *   load the app → submit a route → go fully offline → hard-reload
 *   → the app must load, autocomplete must work, and the last route must
 *     return its cached answer with an "as of" timestamp.
 *
 * Needs a live API key for the first (online) request, so it is skipped unless
 * asked for:
 *
 *   RAILRADAR_ACCEPTANCE=1 PORT=3123 npx playwright test e2e/offline.spec.ts --project=mobile
 *
 * A dev server will not do: `next dev` serves unbundled modules that the
 * precache manifest knows nothing about, so offline reloads fail for reasons
 * that have nothing to do with the app. Run `npm run build && npm start` first.
 */
test.skip(
  !process.env.RAILRADAR_ACCEPTANCE,
  "needs a production build and a live RailRadar key; set RAILRADAR_ACCEPTANCE=1"
);

/** Waits for the worker to be installed *and* controlling this page. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg?.active && navigator.serviceWorker.controller);
    },
    undefined,
    { timeout: 30_000 }
  );
}

async function pickStations(page: Page): Promise<void> {
  await page
    .getByRole("combobox", { name: "Home station" })
    .pressSequentially("borivali", { delay: 30 });
  await page.getByRole("option", { name: /borivali/i }).first().click();

  await page
    .getByRole("combobox", { name: "College station" })
    .pressSequentially("churchgate", { delay: 30 });
  await page.getByRole("option", { name: /churchgate/i }).first().click();
}

test("the app answers from the platform with no signal at all", async ({
  page,
  context,
}) => {
  // ---- 1. Online: load, and let the worker take control ------------------
  await page.goto("/");
  await waitForServiceWorker(page);

  // The precache runs after `load`; give it the moment it needs to finish
  // writing the shell before we cut the network out from under it.
  await page.waitForTimeout(2500);

  // ---- 2. Online: submit a route ----------------------------------------
  await pickStations(page);
  await page.getByLabel("Class start time").fill("22:50");
  await page.getByRole("button", { name: "Find my train" }).click();

  await expect(page.getByText("Best pick")).toBeVisible({ timeout: 20_000 });
  const liveTrain = await page.locator("[class*=font-mono]").first().textContent();
  // A live answer must not be wearing the saved-answer label.
  await expect(page.getByTestId("cached-notice")).toHaveCount(0);
  console.log(`ONLINE: best pick train ${liveTrain?.trim()}`);

  // ---- 3. Go fully offline ----------------------------------------------
  await context.setOffline(true);

  // ---- 4. Hard-reload with no network -----------------------------------
  await page.reload({ waitUntil: "load" });

  // The app loaded at all. Without the service worker this is a browser error
  // page and every assertion below is unreachable.
  await expect(
    page.getByRole("heading", { level: 1, name: "Class Commute" })
  ).toBeVisible();
  console.log("OFFLINE: shell loaded from precache");

  // The banner is present, and honest about what still works.
  await expect(page.getByTestId("offline-banner")).toBeVisible();

  // ---- 5. Autocomplete, with no network ---------------------------------
  await page
    .getByRole("combobox", { name: "Home station" })
    .pressSequentially("bori", { delay: 30 });
  await expect(page.getByRole("option", { name: /borivali/i }).first()).toBeVisible();
  console.log("OFFLINE: autocomplete resolved from the bundled station list");

  // An alias too — that data is bundled, not fetched.
  await page.getByRole("combobox", { name: "Home station" }).fill("vt");
  await expect(page.getByRole("option").first()).toBeVisible();

  // ---- 6. The last route returns its cached answer ----------------------
  await page.getByRole("combobox", { name: "Home station" }).fill("");
  await pickStations(page);
  await page.getByLabel("Class start time").fill("22:50");
  await page.getByRole("button", { name: "Find my train" }).click();

  await expect(page.getByText("Best pick")).toBeVisible({ timeout: 10_000 });

  // Marked as saved, with the time it was fetched — not passed off as live.
  const notice = page.getByTestId("cached-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/saved answer, as of/i);
  await expect(notice).toContainText(/\d{1,2}:\d{2}/);

  const cachedTrain = await page.locator("[class*=font-mono]").first().textContent();
  expect(cachedTrain?.trim()).toBe(liveTrain?.trim());
  console.log(
    `OFFLINE: same train ${cachedTrain?.trim()} returned from IndexedDB, labelled "${(
      await notice.textContent()
    )?.trim()}"`
  );

  await context.setOffline(false);
});

test("offline and never asked before: says so at once, with no spinner", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await waitForServiceWorker(page);
  await page.waitForTimeout(2000);

  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });

  // A route this device has never asked about.
  await page
    .getByRole("combobox", { name: "Home station" })
    .pressSequentially("thane", { delay: 30 });
  await page.getByRole("option", { name: /thane/i }).first().click();
  await page
    .getByRole("combobox", { name: "College station" })
    .pressSequentially("panvel", { delay: 30 });
  await page.getByRole("option", { name: /panvel/i }).first().click();
  await page.getByLabel("Class start time").fill("09:00");

  const started = Date.now();
  await page.getByRole("button", { name: "Find my train" }).click();

  // Immediately, and with something the user can act on — not a spinner that
  // can never resolve.
  // Scoped by test id: Next renders its own role="alert" route announcer.
  const alert = page.getByTestId("result-error");
  await expect(alert).toBeVisible({ timeout: 3000 });
  await expect(alert).toContainText(/offline/i);
  await expect(alert).toContainText(/search once/i);

  const elapsed = Date.now() - started;
  console.log(`OFFLINE + uncached: answered in ${elapsed}ms`);
  expect(elapsed).toBeLessThan(3000);

  await context.setOffline(false);
});
