import { expect, test } from "@playwright/test";
test("isolated lab loads all five models and exposes shape comparisons without saving a scene", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?geometry-lab");
  await expect(
    page.getByRole("heading", { name: "Shape inspection lab" }),
  ).toBeVisible();
  for (const title of [
    "Sculptural walnut coffee table",
    "Cream desk chair",
    "Linen sofa",
    "Olive tree",
    "Poly Haven ceramic vase",
  ]) {
    await page.getByLabel("Lab model").selectOption({ label: title });
    await expect(
      page.getByRole("status", { name: "Geometry build status" }),
    ).toContainText(`${title}:`);
    await expect(page.getByTestId("probe-box")).toBeVisible();
    await expect(page.getByTestId("ray-surface")).toBeVisible();
  }
  await page
    .getByLabel("Lab model")
    .selectOption({ label: "Cream desk chair" });
  await expect(
    page.getByRole("status", { name: "Geometry build status" }),
  ).toContainText("Cream desk chair:");
  await page.getByLabel("Geometry overlay").selectOption("box");
  await page.screenshot({ path: "test-results/geometry-chair-box.png" });
  await page.getByLabel("Geometry overlay").selectOption("compound");
  await page.screenshot({ path: "test-results/geometry-chair-compound.png" });
  await page.getByRole("button", { name: "Run query benchmark" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("house.scene.")),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
