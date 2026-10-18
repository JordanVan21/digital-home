import { expect, test } from "@playwright/test";

test("renders the room and edits, undoes and restores a saved arrangement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library" }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  await page.screenshot({ path: "test-results/room-initial.png" });
  await page.getByRole("button", { name: "Open furniture library" }).click();
  await page
    .getByRole("button", { name: "Add Round brass side table", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Round brass side table" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rotate freely (Shift to snap)" })
    .click();
  await expect(page.getByLabel("Rotation in degrees")).toHaveValue("0");
  await page.getByRole("button", { name: "Move up or down (Y)" }).click();
  await expect(
    page.getByRole("button", { name: "Move up or down (Y)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Height in meters").fill("0.4");
  await page.getByLabel("Height in meters").press("Tab");
  await expect(page.getByLabel("Height in meters")).toHaveValue("0.4");
  await page.getByRole("button", { name: "Move (G)", exact: true }).click();
  await page
    .getByRole("button", { name: "Rotate clockwise 15°", exact: true })
    .click();
  const rotation = page.getByLabel("Rotation in degrees");
  await expect(rotation).toHaveValue("15");
  // Edits are suggestions: the room is unsaved until accepted.
  await expect(
    page.getByRole("status").filter({ hasText: "1 unsaved suggestion" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rotation).toHaveValue("0");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(rotation).toHaveValue("15");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Applied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem(
        "house.scene.v1.00000000-0000-4000-8000-000000000004",
      )!,
    ),
  );
  expect(saved.objects).toHaveLength(13);
  // Shape-based support can resolve onto an exposed patch or the floor.
  // Validate the saved geometry rather than requiring the old box-top target.
  const feasible = await page.evaluate(async () => {
    const urls = performance.getEntriesByType("resource").map((r) => r.name);
    const engineUrl = urls.find((url) =>
      new URL(url).pathname.endsWith("/scene-engine/src/index.ts"),
    )!;
    const editorUrl = urls.find(
      (url) => new URL(url).pathname === "/src/state/editor.ts",
    )!;
    const { validateObject } = await import(engineUrl);
    const { editor } = await import(editorUrl);
    const scene = editor.scene.getState().scene;
    return scene.objects.every(
      (o: unknown) => validateObject(scene, o, editor.context()).ok,
    );
  });
  expect(feasible).toBe(true);
  expect(saved.objects[12].transform.rotation[1]).toBeCloseTo(
    Math.sin(Math.PI / 24),
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".proxy-label").length === 1,
  );
  await page.getByRole("button", { name: "Open furniture library" }).click();
  await page.getByRole("button", { name: "Close furniture library" }).click();
  await page.screenshot({ path: "test-results/room-saved.png" });
  // Drag the sofa onto the coffee table: allowed as a conflicted suggestion,
  // then resolved to the nearest valid spot on accept.
  await page.mouse.move(700, 470);
  await page.mouse.down();
  await page.mouse.move(670, 500, { steps: 8 });
  await page.mouse.move(640, 530, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".conflict-count")).toHaveText(/1 conflict/);
  await page.screenshot({ path: "test-results/room-conflict.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "to fit" }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/room-resolved.png" });
  // Lighting presets restyle the room and the UI accent together.
  await page.getByRole("button", { name: /^Lighting: Golden hour/ }).click();
  await expect(
    page.getByRole("button", { name: /^Lighting: Daylight/ }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/room-daylight.png" });
  expect(errors).toEqual([]);
});
