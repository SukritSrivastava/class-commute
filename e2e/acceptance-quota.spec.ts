import { expect, test } from "@playwright/test";

/**
 * ACCEPTANCE RUN — not part of CI.
 *
 * Drives the real flow against a real RailRadar key so the dev server's log can
 * be counted afterwards: load the page, type two station names, submit, change
 * the buffer, submit again.
 *
 * Run with:
 *   RAILRADAR_ACCEPTANCE=1 PORT=3123 npx playwright test e2e/acceptance-quota.spec.ts --project=mobile --reporter=list
 *
 * Then count the dev server's log:
 *   grep -c "railradar] UPSTREAM" dev.log
 *
 * Skipped unless that env var is set, because it needs a live API key and
 * spends real quota — CI must never run it.
 */
test.skip(
  !process.env.RAILRADAR_ACCEPTANCE,
  "needs a live RailRadar key; set RAILRADAR_ACCEPTANCE=1 to run"
);

test("full flow: type two stations, submit, change buffer, submit again", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) {
      apiRequests.push(`${r.method()} ${url.pathname}`);
    }
  });

  await page.goto("/");

  // --- type two station names, character by character ---
  await page
    .getByRole("combobox", { name: "From" })
    .pressSequentially("borivali", { delay: 40 });
  await page.getByRole("option", { name: /borivali/i }).first().click();

  await page
    .getByRole("combobox", { name: "To" })
    .pressSequentially("churchgate", { delay: 40 });
  await page.getByRole("option", { name: /churchgate/i }).first().click();

  console.log(`API requests after typing: ${JSON.stringify(apiRequests)}`);

  // Two hours out from a ~20:50 IST run, so there are still trains to find.
  await page.getByLabel("Class start time").fill("22:50");

  // --- first submit ---
  await page.getByRole("button", { name: "Find my train" }).click();
  await expect(page.getByText("Best pick")).toBeVisible({ timeout: 15_000 });
  console.log("--- FIRST SUBMIT DONE ---");

  // --- change the buffer, submit again ---
  await page.getByRole("button", { name: "Increase buffer by 5 minutes" }).click();
  await page.getByRole("button", { name: "Increase buffer by 5 minutes" }).click();
  await page.getByRole("button", { name: "Find my train" }).click();
  await expect(page.getByText("Best pick")).toBeVisible({ timeout: 15_000 });
  console.log("--- SECOND SUBMIT DONE ---");

  console.log(`All API requests: ${JSON.stringify(apiRequests, null, 2)}`);

  // Two submits, and nothing at all from the typing.
  expect(apiRequests.filter((r) => r.includes("/api/stations/search"))).toEqual([]);
  expect(apiRequests.filter((r) => r.includes("/api/best-train"))).toHaveLength(2);
});
