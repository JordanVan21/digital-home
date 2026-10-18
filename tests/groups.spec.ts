import type { SceneObject } from "@house/contracts";
import { expect, test } from "@playwright/test";
test("groups persist after Accept and reload; Alt picks a member", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  const read = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return {
        ids: editor.interaction.getState().selectedIds,
        steps: editor.draft.getState().undo.length,
        positions: editor
          .working()
          .objects.map((o: SceneObject) => o.transform.position),
        points: editor
          .working()
          .objects.map((o: SceneObject) =>
            editor.motion.projectPoint([
              o.transform.position[0],
              0.24,
              o.transform.position[2],
            ]),
          ),
      };
    });
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    const o = editor
      .working()
      .objects.find((o: SceneObject) => o.id.endsWith("0111"));
    const copy = structuredClone(o);
    copy.id = "00000000-0000-4000-8000-000000000999";
    copy.displayName = "Second scanned table";
    copy.transform.position = [1, 0, 1.75];
    editor.scene.setState({
      scene: { ...editor.working(), objects: [o, copy] },
    });
  });
  await page.waitForTimeout(600);
  const before = await read();
  await page.screenshot({ path: "test-results/groups-initial.png" });
  await page.mouse.click(...(before.points[0] as [number, number]));
  await page.keyboard.down("Shift");
  await page.mouse.click(...(before.points[1] as [number, number]));
  await page.keyboard.up("Shift");
  await expect(
    page.getByRole("status").filter({ hasText: "2 objects selected" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/groups-before.png" });
  await page.keyboard.press("ControlOrMeta+g");
  await expect(
    page.getByRole("button", { name: "Ungroup selection", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  await page.waitForTimeout(600);
  const restored = await read();
  await page.mouse.click(...(restored.points[0] as [number, number]));
  await expect.poll(async () => (await read()).ids.length).toBe(2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/groups-after.png" });
  await page.keyboard.down("Alt");
  await page.mouse.click(...(restored.points[0] as [number, number]));
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await read()).ids.length).toBe(1);
  await page.keyboard.press("ControlOrMeta+Shift+g");
  await expect(
    page.getByRole("button", { name: "Ungroup selection", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await page.mouse.click(...(restored.points[0] as [number, number]));
  await expect.poll(async () => (await read()).ids.length).toBe(2);
});
