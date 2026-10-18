import { expect, test } from "@playwright/test";

test("Accept preserves a real chair tucked under a desktop and reloads it", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library" }),
  ).toBeVisible();
  await page.waitForFunction(async () => {
    // Match Vite's active HMR URL so the test uses the displayed editor store.
    const modulePath = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((url) => new URL(url).pathname === "/src/state/editor.ts")!;
    return (await import(modulePath)).editor.scene.getState().ready;
  });
  await page.evaluate(async () => {
    // Match Vite's active HMR URL so the test uses the displayed editor store.
    const modulePath = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((url) => new URL(url).pathname === "/src/state/editor.ts")!;
    const { editor } = await import(modulePath);
    const scene = structuredClone(editor.scene.getState().scene);
    const desk = scene.objects.find((o: { id: string }) =>
      o.id.endsWith("000109"),
    );
    const chair = scene.objects.find((o: { id: string }) =>
      o.id.endsWith("000110"),
    );
    desk.locked = false;
    desk.transform.position = [0, 0, 0];
    desk.transform.rotation = [0, 0, 0, 1];
    chair.transform.position = [0, 0, 1];
    chair.transform.rotation = [0, 1, 0, 0];
    scene.objects = [desk, chair];
    editor.discard();
    editor.scene.setState({ scene, ready: true });
    editor.select(chair.id);
    editor.suggest({
      type: "move",
      objectId: chair.id,
      transform: { ...chair.transform, position: [0, 0, 0.5] },
    });
    if (!editor.draft.getState().scene)
      throw new Error("Suggestion was not created");
    if (editor.draft.getState().conflicts[chair.id])
      throw new Error("Tucked chair incorrectly conflicts");
  });
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  const position = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem(
        "house.scene.v1.00000000-0000-4000-8000-000000000004",
      );
      return raw
        ? JSON.parse(raw).objects.find((o: { id: string }) =>
            o.id.endsWith("000110"),
          ).transform.position
        : null;
    });
  await expect.poll(position).toEqual([0, 0, 0.5]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open furniture library" }),
  ).toBeVisible();
  await expect.poll(position).toEqual([0, 0, 0.5]);
  expect(errors).toEqual([]);
});

test("rejects a coffee table hidden in the couch and toggles current bounding boxes", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library" }),
  ).toBeVisible();
  const url = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((u) => new URL(u).pathname === "/src/state/editor.ts")!,
  );
  await page.waitForFunction(
    async (u) => (await import(u)).editor.scene.getState().ready,
    url,
  );
  await page.evaluate(async (u) => {
    const { editor } = await import(u);
    const scene = structuredClone(editor.working());
    const sofa = scene.objects.find((o: { id: string }) =>
      o.id.endsWith("000100"),
    );
    const table = scene.objects.find((o: { id: string }) =>
      o.id.endsWith("000102"),
    );
    sofa.transform.position = [0, 0, 0];
    sofa.transform.rotation = [0, 0, 0, 1];
    table.transform.position = [0, 0, 1.5];
    table.transform.rotation = [0, 0, 0, 1];
    scene.objects = [sofa, table];
    editor.scene.setState({ scene, ready: true });
    editor.select(table.id);
    editor.suggest(
      {
        type: "move",
        objectId: table.id,
        transform: { ...table.transform, position: [0, 0, 0] },
      },
      { snap: false },
    );
    if (!editor.draft.getState().conflicts[table.id])
      throw new Error("Contained table was not flagged");
  }, url);
  await expect(page.locator(".conflict-count")).toHaveText(/1 conflict/);
  const boxes = page.getByRole("button", {
    name: "Bounding boxes",
    exact: true,
  });
  await expect(boxes).toHaveAttribute("aria-pressed", "false");
  await boxes.click();
  await expect(boxes).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: "test-results/couch-containment-bounding-boxes.png",
  });
  await boxes.click();
  await expect(boxes).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(async (u) => {
    const { editor } = await import(u);
    if (editor.draft.getState().undo.length !== 1)
      throw new Error("View toggle changed scene history");
  }, url);
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await page.evaluate(async (u) => {
    const { editor } = await import(u);
    const engineUrl = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((u) => new URL(u).pathname.endsWith("/scene-engine/src/index.ts"))!;
    const { objectsCollide } = await import(engineUrl);
    const [sofa, table] = editor.working().objects;
    if (objectsCollide(sofa, table, editor.context().assets))
      throw new Error("Accept retained the contained table");
  }, url);
  expect(errors).toEqual([]);
});
