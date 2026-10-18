import { expect, test } from "@playwright/test";
test("XYZ inspector entries stay exact in the draft and undo individually", async ({
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
  await page.screenshot({ path: "test-results/position-before.png" });
  for (const [label, value] of [
    ["X position in meters", "1.123"],
    ["Height in meters", "0.731"],
    ["Z position in meters", "1.456"],
  ]) {
    await page.getByRole("spinbutton", { name: label }).fill(value);
    await page.getByRole("spinbutton", { name: label }).press("Enter");
  }
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
  const position = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    return editor.selected().transform.position;
  });
  expect(position).toEqual([1.123, 0.731, 1.456]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/position-after.png" });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.getByRole("spinbutton", { name: "Z position in meters" }),
  ).toHaveValue("1.75");
});
