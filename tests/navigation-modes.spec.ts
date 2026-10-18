import { expect, test } from "@playwright/test";
type NavigationWindow = Window & {
  navigationEditor: typeof import("../apps/web/src/state/editor").editor;
};

for (const mode of ["Orbit", "Pan"] as const) {
  test(`${mode} left-drags navigate through furniture without selecting or editing it`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("radio", { name: "Edit objects" }),
    ).toBeChecked();
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      const object = editor
        .working()
        .objects.find((o: { locked: boolean }) => !o.locked)!;
      editor.select(object.id);
      editor.interaction.setState({ tool: "rotate" });
      (window as unknown as NavigationWindow).navigationEditor = editor;
    });
    const read = () =>
      page.evaluate(() => {
        const e = (window as unknown as NavigationWindow).navigationEditor;
        const object = e
          .working()
          .objects.find(
            (o: { id: string }) => o.id === e.interaction.getState().selectedId,
          );
        if (!object || !e.motion.projectPoint)
          throw new Error(
            "Selected furniture and camera projection must be ready.",
          );
        const p = object.transform.position;
        return {
          position: [...e.motion.cameraPosition],
          direction: [...e.motion.cameraDirection],
          target: [...e.motion.cameraTarget],
          selected: e.interaction.getState().selectedId,
          scene: JSON.stringify(e.working()),
          draft: e.hasDraft(),
          point: e.motion.projectPoint([
            p[0],
            p[1] + object.dimensionsM[1] / 2,
            p[2],
          ]) as [number, number],
          dragging: e.interaction.getState().dragging,
        };
      });
    await expect(page.getByRole("toolbar", { name: /tools$/ })).toBeVisible();
    await page.getByRole("radio", { name: `${mode} camera` }).click();
    await expect(page.getByRole("toolbar", { name: /tools$/ })).toHaveCount(0);
    await page.waitForTimeout(400);
    const before = await read();
    if (mode === "Pan") await page.keyboard.down("Shift");
    await page.mouse.move(...before.point);
    await page.mouse.down();
    await page.mouse.move(before.point[0] + 100, before.point[1] + 45, {
      steps: 20,
    });
    await page.mouse.up();
    if (mode === "Pan") await page.keyboard.up("Shift");
    await expect
      .poll(async () => {
        const after = await read();
        const a = mode === "Orbit" ? after.direction : after.target;
        const b = mode === "Orbit" ? before.direction : before.target;
        return Math.hypot(...a.map((v: number, i: number) => v - b[i]));
      })
      .toBeGreaterThan(0.03);
    const after = await read();
    expect(after.selected).toBe(before.selected);
    expect(after.scene).toBe(before.scene);
    expect(after.draft).toBe(false);
    expect(after.dragging).toBe(false);
    if (mode === "Pan")
      expect(
        Math.hypot(
          ...after.direction.map(
            (v: number, i: number) => v - before.direction[i],
          ),
        ),
      ).toBeLessThan(0.02);
    await page.screenshot({
      path: `test-results/navigation-${mode.toLowerCase()}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("radio", { name: "Edit objects" }),
    ).toBeChecked();
    await expect(page.getByRole("toolbar", { name: /tools$/ })).toBeVisible();
    expect((await read()).selected).toBe(before.selected);
  });
}
