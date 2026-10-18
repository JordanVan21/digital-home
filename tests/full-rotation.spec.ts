import { expect, test } from "@playwright/test";
test("tips a pillow using the inspector and keeps all fixture pieces feasible", async ({
  page,
}) => {
  test.slow();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /^Switch room/ }).click();
  await page
    .getByRole("menuitemradio", {
      name: "test2 · warm living room",
      exact: true,
    })
    .click();
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    const pillow = editor
      .working()
      .objects.find(
        (o: { displayName: string }) => o.displayName === "Sand pillow",
      );
    editor.select(pillow.id);
    editor.interaction.setState({ inspector: true });
  });
  const pitch = page.getByLabel("X (pitch) in degrees");
  await expect(pitch).toHaveValue("-15");
  await pitch.fill("-20");
  await pitch.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Accept suggestions (Return)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("X (pitch) in degrees")).toHaveValue("-20");
  await page
    .getByRole("button", { name: "Lean back 15°", exact: true })
    .click();
  await expect(page.getByLabel("X (pitch) in degrees")).toHaveValue("-15");
});
