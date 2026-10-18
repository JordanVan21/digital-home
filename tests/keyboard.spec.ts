import { expect, test } from "@playwright/test";
test("keyboard nudges and turns use suggestions; framing and walk stay view-only", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
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
  await page.screenshot({ path: "test-results/keyboard-before.png" });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("e");
  const state = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return {
        steps: editor.draft.getState().undo.length,
        view: editor.interaction.getState().cameraView,
        walk: editor.interaction.getState().walk,
      };
    });
  await expect.poll(async () => (await state()).steps).toBe(3);
  await page.keyboard.press("f");
  await expect.poll(async () => (await state()).view).toBe("selection");
  await page.keyboard.press("Home");
  await expect.poll(async () => (await state()).view).toBe("room");
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/keyboard-after.png" });
  await page.keyboard.press("p");
  await expect.poll(async () => (await state()).walk).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await state()).walk).toBe(false);
  expect((await state()).steps).toBe(3);
});
