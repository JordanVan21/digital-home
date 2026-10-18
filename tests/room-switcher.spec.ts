import { expect, test } from "@playwright/test";

test("switches to test2, keeps it across a reload and switches back", async ({
  page,
}) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const switcher = page.getByRole("button", { name: /^Switch room/ });
  await expect(switcher).toHaveAccessibleName(
    "Switch room (current: Living room)",
  );
  const pieces = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!;
      const { editor } = await import(url);
      return editor.working().objects.length as number;
    });
  await switcher.click();
  await page
    .getByRole("menuitemradio", { name: "test2 · warm living room" })
    .click();
  await expect(switcher).toHaveAccessibleName(
    "Switch room (current: test2 · warm living room)",
  );
  await expect.poll(pieces).toBe(45);
  await page.reload();
  await expect(switcher).toHaveAccessibleName(
    "Switch room (current: test2 · warm living room)",
  );
  await expect.poll(pieces).toBe(45);
  await switcher.click();
  await page
    .getByRole("menuitemradio", { name: "Living room", exact: true })
    .click();
  await expect.poll(pieces).toBe(12);
  expect(errors).toEqual([]);
});
