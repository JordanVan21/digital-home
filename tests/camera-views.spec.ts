import { expect, test } from "@playwright/test";
test("changes views, walks smoothly, frames selection, and keeps furniture drags ahead of the camera", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  const motion = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return {
        position: [...editor.motion.cameraPosition],
        direction: [...editor.motion.cameraDirection],
        target: [...editor.motion.cameraTarget],
        draft: editor.hasDraft(),
      };
    });
  const view = async (name: string) => {
    await page
      .getByRole("button", { name: "Camera views", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  await view("Top view");
  await expect
    .poll(async () => (await motion()).direction[1])
    .toBeLessThan(-0.99);
  await expect(
    page.getByRole("button", { name: "2D plan view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await view("Eye-level view");
  await expect
    .poll(async () => (await motion()).position[1])
    .toBeCloseTo(1.6, 1);
  await view("Isometric view");
  await expect
    .poll(async () => (await motion()).position[0])
    .toBeCloseTo(7.2, 1);
  await page.waitForTimeout(600);
  const maximumStep = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    let previous = [...editor.motion.cameraPosition],
      max = 0;
    editor.setWalk(true);
    return await new Promise<number>((resolve) => {
      let frames = 0;
      const sample = () => {
        const next = [...editor.motion.cameraPosition];
        max = Math.max(
          max,
          Math.hypot(...next.map((n: number, i: number) => n - previous[i])),
        );
        previous = next;
        if (++frames < 50) requestAnimationFrame(sample);
        else resolve(max);
      };
      requestAnimationFrame(sample);
    });
  });
  expect(maximumStep).toBeLessThan(2);
  const beforeWalk = await motion();
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  await expect
    .poll(async () =>
      Math.abs((await motion()).position[2] - beforeWalk.position[2]),
    )
    .toBeGreaterThan(0.15);
  expect((await motion()).draft).toBe(false);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    editor.select("00000000-0000-4000-8000-000000000111");
  });
  await view("Frame selection");
  await expect.poll(async () => (await motion()).target[0]).toBeCloseTo(0.2, 1);
  await expect
    .poll(async () => (await motion()).target[2])
    .toBeCloseTo(1.75, 1);
  await view("Isometric view");
  await expect
    .poll(async () => (await motion()).position[0])
    .toBeCloseTo(7.2, 1);
  await page.waitForTimeout(800);
  const cameraBefore = (await motion()).position;
  const origin = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    return editor.motion.projectPoint([0.2, 0.24, 1.75]);
  });
  await page.mouse.move(origin[0], origin[1]);
  await page.mouse.down();
  await page.mouse.move(origin[0] + 50, origin[1] - 10, { steps: 12 });
  await page.mouse.up();
  const after = await motion();
  expect(
    Math.hypot(...after.position.map((n, i) => n - cameraBefore[i])),
  ).toBeLessThan(0.03);
  expect(after.draft).toBe(true);
});
