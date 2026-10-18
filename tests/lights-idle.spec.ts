import { expect, test } from "@playwright/test";
test("stops drawing when idle and saves a lamp switch through the suggestion flow", async ({
  page,
}) => {
  await page.goto("/?perf");
  const perf = page.getByLabel("Rendering performance");
  await expect(perf).toBeVisible();
  await expect(perf).toContainText("Idle");
  const snapshot = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return {
        frames: editor.motion.perf.frames,
        drawCalls: editor.motion.perf.drawCalls,
        triangles: editor.motion.perf.triangles,
        lightOn:
          editor
            .working()
            .objects.find((o: { category: string }) => o.category === "lamp")
            .lightOn ?? true,
      };
    });
  expect((await snapshot()).drawCalls).toBeGreaterThan(10);
  expect((await snapshot()).triangles).toBeGreaterThan(1000);
  await expect
    .poll(async () => {
      const before = (await snapshot()).frames;
      await page.waitForTimeout(350);
      return (await snapshot()).frames - before;
    })
    .toBe(0);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    editor.select(
      editor
        .working()
        .objects.find((o: { category: string }) => o.category === "lamp").id,
    );
  });
  const frames = (await snapshot()).frames;
  await page
    .getByRole("button", { name: "Switch light off", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch light on", exact: true }),
  ).toBeVisible();
  expect((await snapshot()).lightOn).toBe(false);
  await expect
    .poll(async () => (await snapshot()).frames)
    .toBeGreaterThan(frames);
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Rendering performance")).toBeVisible();
  await expect.poll(async () => (await snapshot()).lightOn).toBe(false);
});
