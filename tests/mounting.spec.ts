import { expect, test } from "@playwright/test";
test("adds artwork and a pendant, drags art on its wall and remounts a free ceiling draft on Accept", async ({
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
    editor.scene.setState({ scene: { ...editor.working(), objects: [] } });
  });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/mounting-before.png" });
  for (const title of ["Framed landscape print", "Modern pendant lamp"]) {
    await page
      .getByRole("button", { name: "Open furniture library", exact: true })
      .click();
    await page.getByLabel("Search furniture").fill(title);
    await page
      .getByRole("button", { name: `Add ${title}`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  }
  await page.getByLabel("Height in meters").fill("0.731");
  await page.getByLabel("Height in meters").press("Enter");
  await expect(page.getByLabel("Height in meters")).toHaveValue("0.731");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const state = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    const art = editor
      .working()
      .objects.find((o: { category: string }) => o.category === "wall-art");
    editor.select(art.id);
    return {
      point: editor.motion.projectPoint([
        art.transform.position[0],
        art.transform.position[1] + 0.25,
        art.transform.position[2],
      ]),
      support: editor
        .working()
        .objects.map(
          (o: { placement: { support: string } }) => o.placement.support,
        ),
      height: editor
        .working()
        .objects.find(
          (o: { placement: { support: string } }) =>
            o.placement.support === "ceiling",
        ).transform.position[1],
    };
  });
  expect(state.support).toEqual(expect.arrayContaining(["wall", "ceiling"]));
  expect(state.height).toBeCloseTo(2.6 - 0.952);
  await page.waitForTimeout(500);
  await page.mouse.move(state.point[0], state.point[1]);
  await page.mouse.down();
  await page.mouse.move(state.point[0] + 35, state.point[1] - 15, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("status").filter({ hasText: "1 unsaved suggestion" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/mounting-after.png" });
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
});
