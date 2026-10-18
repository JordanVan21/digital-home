import { expect, test } from "@playwright/test";
test("resizes with proportions and keeps a supported piece seated at its original size", async ({
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
    const o = editor
      .working()
      .objects.find((o: { id: string }) => o.id.endsWith("0111"));
    const child = {
      ...structuredClone(o),
      id: "00000000-0000-4000-8000-000000000999",
      displayName: "Small box on table",
      dimensionsM: [0.1, 0.1, 0.1],
      placement: { support: "object", parentId: o.id },
      transform: { ...o.transform, position: [0.2, 0.48, 1.75] },
    };
    editor.scene.setState({
      scene: { ...editor.working(), objects: [o, child] },
    });
    editor.select(o.id);
  });
  await page.getByLabel("Keep proportions").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/resize-before.png" });
  await page.getByLabel("Width dimension in meters").fill("0.72");
  await page.getByLabel("Width dimension in meters").press("Enter");
  await expect(page.getByLabel("Height dimension in meters")).toHaveValue(
    "0.96",
  );
  const read = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return editor
        .working()
        .objects.map(
          (o: {
            dimensionsM: number[];
            transform: { position: number[] };
          }) => ({ size: o.dimensionsM, y: o.transform.position[1] }),
        );
    });
  expect((await read())[1]).toEqual({ size: [0.1, 0.1, 0.1], y: 0.96 });
  await page.getByLabel("Keep proportions").uncheck();
  await page.getByLabel("Height dimension in meters").fill("0.7");
  await page.getByLabel("Height dimension in meters").press("Enter");
  await expect(page.getByLabel("Width dimension in meters")).toHaveValue(
    "0.72",
  );
  expect((await read())[1].y).toBeCloseTo(0.7);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Height dimension in meters")).toHaveValue(
    "0.96",
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/resize-after.png" });
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  expect((await read())[1]).toEqual({ size: [0.1, 0.1, 0.1], y: 0.96 });
});
