import { expect, test } from "@playwright/test";
test("reviews room finishes, keeps furniture fixed, saves them, and switches wall modes without edits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library", exact: true }),
  ).toBeEnabled();
  const transforms = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return editor
        .working()
        .objects.map((o: { transform: unknown }) => o.transform);
    });
  const before = await transforms();
  await page.getByLabel("Floor finish").selectOption("walnut");
  await expect(
    page.getByRole("button", { name: /^Accept suggestions/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Walls: Cut away", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Walls: Fade", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Walls: Fade", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Walls: Show", exact: true }),
  ).toBeVisible();
  expect(await transforms()).toEqual(before);
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Floor finish")).toHaveValue("walnut");
  expect(await transforms()).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Walls: Cut away", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
