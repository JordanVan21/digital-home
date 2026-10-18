import { expect, test } from "@playwright/test";

test("snaps to a chair seat, carries the item with its chair, and preserves the stack through undo/save/reload", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open furniture library" }),
  ).toBeVisible();
  const moduleUrl = await page.evaluate(
    () =>
      performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((url) => new URL(url).pathname === "/src/state/editor.ts")!,
  );
  await page.waitForFunction(
    async (url) => (await import(url)).editor.scene.getState().ready,
    moduleUrl,
  );
  await page.evaluate(async (url) => {
    const { editor } = await import(url);
    const scene = structuredClone(editor.working());
    const chair = scene.objects.find((o: { id: string }) =>
      o.id.endsWith("000110"),
    );
    const item = scene.objects.find((o: { id: string }) =>
      o.id.endsWith("000111"),
    );
    chair.locked = false;
    chair.transform.position = [0, 0, 0];
    chair.transform.rotation = [0, 0, 0, 1];
    item.displayName = "Seat test box";
    item.dimensionsM = [0.08, 0.1, 0.08];
    item.transform.position = [0.8, 0, 0];
    scene.objects = [chair, item];
    editor.scene.setState({ scene, ready: true });
    editor.select(item.id);
    if (
      !editor.suggest({
        type: "move",
        objectId: item.id,
        transform: { ...item.transform, position: [0, 0.5, 0] },
      })
    )
      throw new Error("Seat snap failed");
  }, moduleUrl);
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Height in meters").inputValue()),
    )
    .toBeCloseTo(0.48, 5);
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  await page.evaluate(async (url) => {
    const { editor } = await import(url);
    const chair = editor.working().objects[0];
    editor.select(chair.id);
    if (
      !editor.suggest({
        type: "move",
        objectId: chair.id,
        transform: { ...chair.transform, position: [0.5, 0, 0] },
      })
    )
      throw new Error("Stack move failed");
    const item = editor.working().objects[1];
    if (
      Math.abs(item.transform.position[0] - 0.5) > 1e-6 ||
      item.placement?.parentId !== chair.id
    )
      throw new Error("Stack separated");
  }, moduleUrl);
  await page.keyboard.press("ControlOrMeta+z");
  await page.evaluate(async (url) => {
    const { editor } = await import(url);
    if (
      editor
        .working()
        .objects.some(
          (o: { transform: { position: number[] } }) =>
            Math.abs(o.transform.position[0]) > 1e-6,
        )
    )
      throw new Error("Stack undo separated its items");
  }, moduleUrl);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.getByRole("button", { name: /^Accept suggestions/ }).click();
  const savedStack = () =>
    page.evaluate(() => {
      const scene = JSON.parse(
        localStorage.getItem(
          "house.scene.v1.00000000-0000-4000-8000-000000000004",
        ) ?? "null",
      );
      return scene?.objects.map(
        (o: {
          id: string;
          placement: unknown;
          transform: { position: number[] };
        }) => ({
          id: o.id,
          placement: o.placement,
          position: o.transform.position,
        }),
      );
    });
  await expect
    .poll(async () => (await savedStack())?.[1].position[0])
    .toBeCloseTo(0.5);
  const saved = await savedStack();
  expect(saved[1].position[1]).toBeCloseTo(0.48, 5);
  expect(saved[1].placement).toEqual({
    support: "object",
    parentId: saved[0].id,
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open furniture library" }),
  ).toBeVisible();
  expect(await savedStack()).toEqual(saved);
  expect(errors).toEqual([]);
});
