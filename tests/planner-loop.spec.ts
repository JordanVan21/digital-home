import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("isolated planner renders, captures three real views, repairs, and leaves the saved room untouched", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const observations: {
    candidateId: string;
    views: { name: string; image: string }[];
  }[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/observe")) observations.push(r.postDataJSON());
  });
  await page.goto("/?planner-lab");
  await expect(
    page.getByRole("heading", { name: "Cozy Japanese–Scandinavian" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run design experiment" }),
  ).toBeEnabled();
  const saved = await page.evaluate(() =>
    JSON.stringify(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("house.scene"))
        .sort()
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  await page.getByLabel("Run mode").selectOption("demo");
  await page.getByRole("button", { name: "Run design experiment" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Visual review completed",
    { timeout: 90_000 },
  );
  expect(observations).toHaveLength(2);
  expect(observations[0].candidateId).not.toBe(observations[1].candidateId);
  for (const observation of observations) {
    expect(observation.views.map((v) => v.name)).toEqual([
      "top",
      "angle-a",
      "angle-b",
    ]);
    expect(new Set(observation.views.map((v) => v.image)).size).toBe(3);
    for (const view of observation.views)
      expect(view.image.length).toBeGreaterThan(10_000);
  }
  await writeFile(
    "test-results/planner-observations.json",
    JSON.stringify(observations),
  );
  await page.getByRole("button", { name: "Show before" }).click();
  await expect(
    page.getByText("Starting snapshot · orbit to inspect"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show proposed design" }).click();
  expect(
    await page.evaluate(() =>
      JSON.stringify(
        Object.keys(localStorage)
          .filter((k) => k.startsWith("house.scene"))
          .sort()
          .map((k) => [k, localStorage.getItem(k)]),
      ),
    ),
  ).toBe(saved);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/planner-loop.png",
    fullPage: true,
  });
});
