import type { SceneObject } from "@house/contracts";
import { expect, test } from "@playwright/test";
test("Shift-click and marquee select pieces and a drag moves the selection once", async ({
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
  await page.screenshot({ path: "test-results/multi-before.png" });
  await page.mouse.click(...(before.points[0] as [number, number]));
  await page.keyboard.down("Shift");
  await page.mouse.click(...(before.points[1] as [number, number]));
  await page.keyboard.up("Shift");
  await expect(
    page.getByRole("status").filter({ hasText: "2 objects selected" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowUp");
  expect((await read()).steps).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  const first = before.points[0];
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  await page.mouse.move(first[0] + 45, first[1], { steps: 12 });
  await page.mouse.up();
  const after = await read();
  expect(after.steps).toBe(1);
  for (let i = 0; i < 3; i++)
    expect(after.positions[0][i] - before.positions[0][i]).toBeCloseTo(
      after.positions[1][i] - before.positions[1][i],
      5,
    );
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/multi-after.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.down("Shift");
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(1050, 850, { steps: 15 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await read()).ids.length).toBe(2);
});
