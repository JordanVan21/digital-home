import { expect, test } from "@playwright/test";
test("duplicates from the toolbar and keyboard as undoable suggestions", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  const count = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return editor.working().objects.length;
    });
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    editor.select("00000000-0000-4000-8000-000000000111");
  });
  await expect(
    page.getByRole("heading", { name: "Scanned side table", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const before = await count();
  await page.screenshot({ path: "test-results/duplicate-before.png" });
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect.poll(count).toBe(before + 1);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(count).toBe(before + 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(count).toBe(before + 1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(count).toBe(before + 2);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/duplicate-after.png" });
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.reload();
  await expect.poll(count).toBe(before + 2);
});
