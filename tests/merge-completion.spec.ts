import { expect, test } from "@playwright/test";
async function select(page: import("@playwright/test").Page, id: string) {
  await page.evaluate(async (id) => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    editor.select(id);
  }, id);
}
test("floating, typed log, save retry and conflict use the real patch path", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  await select(page, "00000000-0000-4000-8000-000000000111");
  await page.getByLabel("Allow floating after Accept").check();
  await page.getByLabel("Height in meters").fill("0.731");
  await page.getByLabel("Height in meters").press("Enter");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await expect(page.getByLabel("Height in meters")).toHaveValue("0.731");
  await page.getByRole("button", { name: /^Edit log/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Edit log" }),
  ).toContainText("Accepted patch");
  await page.screenshot({ path: "test-results/completion-log.png" });
  await page.getByRole("button", { name: /^Edit log/ }).click();
  await page.getByRole("button", { name: "Room menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Simulate save failure", exact: true })
    .click();
  await page.getByLabel("Plan for this piece").selectOption("keep");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await page.getByRole("button", { name: /Save failed.*Retry/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  await select(page, "00000000-0000-4000-8000-000000000111");
  await expect(page.getByLabel("Height in meters")).toHaveValue("0.731");
  await expect(page.getByLabel("Allow floating after Accept")).toBeChecked();
  await page.getByRole("button", { name: "Room menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Simulate another session edit", exact: true })
    .click();
  await page.getByLabel("Plan for this piece").selectOption("replace");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Room changed elsewhere · Reload",
      exact: true,
    }),
  ).toBeVisible();
});
test("finishes, locked plans and reference photo remain independent of camera and geometry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /^Switch room/ }).click();
  await page
    .getByRole("menuitemradio", {
      name: "test2 · warm living room",
      exact: true,
    })
    .click();
  const id = await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(url);
    return editor
      .working()
      .objects.find((o: { displayName: string }) => /sofa/i.test(o.displayName))
      .id;
  });
  await select(page, id);
  await page.getByRole("button", { name: "Finish: Sage", exact: true }).click();
  await page
    .getByRole("button", { name: "Lock selected object", exact: true })
    .click();
  await page.getByLabel("Plan for this piece").selectOption("remove");
  await expect(page.getByLabel("Plan for this piece")).toHaveValue("remove");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/completion-finishes-plan.png" });
  await page
    .getByRole("button", { name: "Reference photo", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Reference for the warm living room" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Match photo", exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "test-results/completion-photo.png" });
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
});
test("library pointer drag drops one suggestion into the room", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open furniture library", exact: true })
    .click();
  await page.getByLabel("Search furniture").fill("Poly Haven ceramic vase");
  const card = page.getByRole("button", {
    name: "Add Poly Haven ceramic vase",
    exact: true,
  });
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error("Missing draggable card");
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 15, y, { steps: 4 });
  await page.mouse.move(650, 550, { steps: 15 });
  await page.mouse.move(651, 551);
  await page.mouse.up();
  await expect(
    page.getByRole("heading", { name: "Poly Haven ceramic vase", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "1 unsaved suggestion" }),
  ).toBeVisible();
});
