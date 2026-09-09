import { expect, test } from "@playwright/test";

/**
 * The autocomplete used to spend a RailRadar request per typing burst, which
 * was the largest drain on a 1,000-request month. It now searches a committed
 * JSON bundle in the browser.
 *
 * This test guards that regression directly: it counts requests to `/api/`
 * while a user types two full station names. Any number above zero means
 * station lookup has crept back onto the network — and from there onto the
 * quota. It deliberately stops short of submitting, so it needs no API key and
 * costs nothing to run in CI.
 */
test("typing station names makes no network requests at all", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
  });

  await page.goto("/");

  const home = page.getByRole("combobox", { name: "From" });
  const college = page.getByRole("combobox", { name: "To" });

  // Type character by character, the way a real user does — this is exactly
  // the pattern that used to produce a request per debounce window.
  await home.pressSequentially("borivali", { delay: 30 });
  await expect(page.getByRole("option", { name: /borivali/i }).first()).toBeVisible();
  await page.getByRole("option", { name: /borivali/i }).first().click();

  await college.pressSequentially("churchgate", { delay: 30 });
  await expect(page.getByRole("option", { name: /churchgate/i }).first()).toBeVisible();
  await page.getByRole("option", { name: /churchgate/i }).first().click();

  expect(apiRequests).toEqual([]);
});

test("a match appears on the very first keystroke", async ({ page }) => {
  await page.goto("/");

  // No debounce and no minimum length: one character is enough, immediately.
  await page.getByRole("combobox", { name: "From" }).fill("d");

  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 1000 });
});

test("an alias finds the station under the name people actually use", async ({
  page,
}) => {
  await page.goto("/");

  // "VT" has not been this station's name since 1996, and "CSMT" is not what
  // the timetable data calls it either.
  await page.getByRole("combobox", { name: "From" }).fill("vt");

  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 1000 });
});
