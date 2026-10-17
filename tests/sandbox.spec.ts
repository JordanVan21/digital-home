import { expect, test } from "@playwright/test";

test("renders the room and edits, undoes and restores a saved arrangement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Browse furniture" }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  await page.screenshot({ path: "test-results/room-initial.png" });
  await page.getByRole("button", { name: "Open furniture library" }).click();
  await page
    .getByRole("button", { name: "Add Round brass side table", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Round brass side table" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rotate clockwise 15°", exact: true })
    .click();
  await expect(page.locator(".rotation-readout output")).toHaveText("15°");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".rotation-readout output")).toHaveText("0°");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator(".rotation-readout output")).toHaveText("15°");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        "house.scene.v1.00000000-0000-4000-8000-000000000004",
      )!,
    ),
  );
  expect(saved.objects).toHaveLength(13);
  expect(saved.objects[12].transform.rotation[1]).toBeCloseTo(
    Math.sin(Math.PI / 24),
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  await page.getByRole("button", { name: "Open furniture library" }).click();
  await page.getByRole("button", { name: "Close furniture library" }).click();
  await page.screenshot({ path: "test-results/room-saved.png" });
  expect(errors).toEqual([]);
});
