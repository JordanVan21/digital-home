import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
const { PerspectiveCamera, Vector3 } = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
)("three");
const camera = new PerspectiveCamera(39, 1.44, 0.1, 100);
camera.position.set(7.2, 6.5, 8.3);
camera.lookAt(0, 0.65, 0);
camera.updateMatrixWorld();
const screen = (x: number, y: number, z: number) => {
  const p = new Vector3(x, y, z).project(camera);
  return { x: (p.x + 1) * 720, y: (1 - p.y) * 500 };
};
test("loads all three local Poly Haven models and shows the correct provider", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  const models = [
    {
      title: "Poly Haven leather dining chair",
      slug: "polyhaven-dining-chair",
    },
    {
      title: "Poly Haven potted succulent",
      slug: "polyhaven-potted-succulent",
    },
    { title: "Poly Haven ceramic vase", slug: "polyhaven-ceramic-vase" },
  ];
  for (const model of models) {
    await page.getByRole("button", { name: "Open furniture library" }).click();
    await page.getByLabel("Search furniture").fill("polyhaven");
    await expect(
      page.getByRole("button", { name: /^Add Poly Haven/ }),
    ).toHaveCount(3);
    const loaded = page.waitForResponse((r) =>
      r.url().endsWith(`/models/${model.slug}.glb`),
    );
    await page
      .getByRole("button", { name: `Add ${model.title}`, exact: true })
      .click();
    const response = await loaded;
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(
      page.getByRole("heading", { name: model.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Poly Haven · CC0 ↗" }),
    ).toHaveAttribute("href", /^https:\/\/polyhaven.com\/a\//);
  }
  await page.waitForTimeout(1200);
  await expect(page.locator(".proxy-label")).toHaveCount(1);
  await page.screenshot({ path: "test-results/polyhaven-imports.png" });
  expect(errors).toEqual([]);
});
test("holds Space to raise and releases to slide during one captured drag", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  const from = screen(0.2, 0.24, 1.75),
    across = screen(0.4, 0.24, 1.75),
    raised = screen(0.4, 0.69, 1.75),
    end = screen(0.7, 0.69, 1.75);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(across.x, across.y, { steps: 10 });
  await page.keyboard.down("Space");
  await page.mouse.move(across.x, across.y);
  await page.mouse.move(raised.x, raised.y, { steps: 15 });
  await page.keyboard.up("Space");
  await page.mouse.move(raised.x, raised.y);
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.getByRole("heading", { name: "Scanned side table" }),
  ).toBeVisible();
  const height = Number(await page.getByLabel("Height in meters").inputValue());
  expect(height).toBeGreaterThan(0.4);
  expect(height).toBeLessThan(0.5);
  const x = Number(await page.getByLabel("X position in meters").inputValue());
  expect(x).toBeGreaterThan(0.6);
  expect(x).toBeLessThan(0.8);
  await expect(
    page.getByRole("status").filter({ hasText: "1 unsaved suggestion" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByLabel("Height in meters")).toHaveValue("0");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
});
