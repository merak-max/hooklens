import { expect, test } from "@playwright/test";

test("creates an inbox, receives a webhook, and filters the live event", async ({ page, request }) => {
  await page.goto("/");
  await page.getByLabel("New inbox").fill("Browser test inbox");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await expect(page.getByText("Browser test inbox").first()).toBeVisible();

  const endpoint = await page.locator(".endpoint code").textContent();
  expect(endpoint).toBeTruthy();
  await request.post(endpoint!, { data: { event: "payment.succeeded", amount: 4200 } });

  await expect(page.getByRole("button", { name: /payment\.succeeded/ })).toBeVisible();
  await page.getByLabel("Search events").fill("4200");
  await expect(page.getByRole("button", { name: /payment\.succeeded/ })).toBeVisible();
  await page.getByLabel("Search events").fill("not-present");
  await expect(page.getByText("No matching events")).toBeVisible();
});

test("is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dimensions = await page.locator("body").evaluate((body) => ({ scrollWidth: body.scrollWidth, clientWidth: body.clientWidth }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});
