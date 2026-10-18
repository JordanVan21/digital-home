import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const { PerspectiveCamera, Vector3 } = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
)("three");
const camera = new PerspectiveCamera(39, 1.44, 0.1, 100);
camera.position.set(7.2, 6.5, 8.3);
camera.lookAt(0, 0.65, 0);
camera.updateMatrixWorld();
const project = (x: number, y: number, z: number) => {
  const point = new Vector3(x, y, z).project(camera);
  return { x: (point.x + 1) * 720, y: (1 - point.y) * 500 };
};

test("mouse placement snaps to a tabletop before Accept, survives reload, and returns to the floor", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const fixture = { roomId: "00000000-0000-4000-8000-000000000004" };
  const small = {
    id: "00000000-0000-4000-8000-000000000111",
    displayName: "Scanned side table",
    dimensionsM: [0.36, 0.48, 0.36],
    transform: { position: [0.2, 0, 1.75] },
  };
  const catalog = JSON.parse(
    readFileSync(
      new URL("../packages/contracts/src/catalog.json", import.meta.url),
      "utf8",
    ),
  ) as { id: string; category: string; title: string; dimensionsM: number[] }[];
  const asset = catalog.find((o) => o.category === "coffee-table")!;
  const table = {
    ...asset,
    displayName: asset.title,
    id: "00000000-0000-4000-8000-000000000102",
    transform: { position: [-0.55, 0, 0.58] },
  };
  const height = table.dimensionsM[1];
  await page.goto("/");
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  const origin = project(
    small.transform.position[0],
    small.dimensionsM[1] / 2,
    small.transform.position[2],
  );
  await page.mouse.click(origin.x, origin.y);
  await expect(
    page.getByRole("heading", { name: small.displayName }),
  ).toBeVisible();
  // Lift away from all surfaces, then move the elevated box over the coffee table.
  await page.getByLabel("Height in meters").fill(String(height + 0.3));
  await page.getByLabel("Height in meters").press("Tab");
  await page.getByRole("button", { name: "Move (G)", exact: true }).click();
  // Allow the display group to ease to the drafted height before grabbing it.
  await page.waitForTimeout(1200);
  const from = project(
    small.transform.position[0],
    height + 0.3 + small.dimensionsM[1] / 2,
    small.transform.position[2],
  );
  const to = project(
    table.transform.position[0],
    height + 0.3 + small.dimensionsM[1] / 2,
    table.transform.position[2],
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.mouse.up();
  await expect(
    page.getByRole("heading", { name: small.displayName }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Move up or down (Y)" }).click();
  await page.waitForTimeout(900);
  const lifted = project(
    table.transform.position[0],
    height + 0.3 + small.dimensionsM[1] / 2,
    table.transform.position[2],
  );
  const nearTop = project(
    table.transform.position[0],
    height + 0.03 + small.dimensionsM[1] / 2,
    table.transform.position[2],
  );
  await page.mouse.move(lifted.x, lifted.y);
  await page.mouse.down();
  await page.mouse.move(nearTop.x, nearTop.y, { steps: 15 });
  await expect(
    page.getByText(`Snapped to ${table.displayName}`, { exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".conflict-count")).toHaveCount(0);
  await expect(page.getByLabel("Height in meters")).toHaveValue(
    String(Number(height.toFixed(3))),
  );
  await expect(
    page.getByText(`Resting on ${table.displayName}.`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    `house.scene.v1.${fixture.roomId}`,
  );
  const stacked = saved.objects.find((o: { id: string }) => o.id === small.id);
  expect(stacked.transform.position[1]).toBe(height);
  expect(stacked.placement).toEqual({ support: "object", parentId: table.id });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  const center = project(
    stacked.transform.position[0],
    height + small.dimensionsM[1] / 2,
    stacked.transform.position[2],
  );
  await page.mouse.click(center.x, center.y);
  await expect(
    page.getByText(`Resting on ${table.displayName}.`, { exact: true }),
  ).toBeVisible();
  // Moving away from the tabletop and approaching floor height should catch at zero.
  await page.getByRole("button", { name: "Move (G)", exact: true }).click();
  const away = project(
    small.transform.position[0],
    height + small.dimensionsM[1] / 2,
    small.transform.position[2],
  );
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 15 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Move up or down (Y)" }).click();
  await page.waitForTimeout(900);
  const floorTarget = project(
    small.transform.position[0],
    0.03 + small.dimensionsM[1] / 2,
    small.transform.position[2],
  );
  await page.mouse.move(away.x, away.y);
  await page.mouse.down();
  await page.mouse.move(floorTarget.x, floorTarget.y, { steps: 15 });
  await expect(
    page.getByText("Snapped to Floor", { exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await expect(page.getByLabel("Height in meters")).toHaveValue("0");
  await expect(page.locator(".conflict-count")).toHaveCount(0);
  expect(errors).toEqual([]);
});
