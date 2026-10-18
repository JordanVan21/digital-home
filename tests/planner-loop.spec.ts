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
  await page.getByLabel("Run mode").selectOption("demo");
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
  const completion = page.waitForResponse(
    async (r) =>
      r.url().endsWith("/observe") &&
      r.request().method() === "POST" &&
      (await r.json()).done === true,
  );
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/planner-api/sessions") &&
        r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Run design experiment" }).click(),
  ]);
  const proposal = await response.json();
  expect(response.ok()).toBe(true);
  const replacements = proposal.candidate.scene.objects.filter(
    (o: { replacesObjectId?: string }) => o.replacesObjectId,
  );
  expect(replacements.length).toBeGreaterThanOrEqual(2);
  for (const object of replacements) expect(object.assetId).not.toBeNull();
  await expect(page.getByRole("status")).toContainText(
    "Catalog demo completed",
    { timeout: 90_000 },
  );
  const finished = await (await completion).json();
  const realCount = finished.candidate.scene.objects.filter(
    (o: { assetId: string | null }) => o.assetId,
  ).length;
  await expect(page.getByTestId("model-summary")).toContainText(
    `${realCount} real models ready`,
  );
  await expect(page.getByTestId("model-summary")).toContainText(
    "0 failed to load",
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

test("a missing furniture queue blocks live runs before AI and offers the real-model demo", async ({
  page,
}) => {
  await page.route("**/planner-api/readiness", (route) =>
    route.fulfill({
      json: {
        liveReady: false,
        aiConfigured: true,
        renderStatus: "queue_missing",
        catalogCount: 233,
        catalogSource: "shared",
        message:
          "Live furniture requests are not connected yet. Try the catalog demo.",
      },
    }),
  );
  let starts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/planner-api/sessions")) starts++;
  });
  await page.goto("/?planner-lab");
  await expect(page.getByLabel("Furniture connection")).toContainText(
    "not connected",
  );
  await expect(
    page.getByRole("button", { name: "Run design experiment" }),
  ).toBeDisabled();
  expect(starts).toBe(0);
  await page.getByLabel("Run mode").selectOption("demo");
  await expect(
    page.getByRole("button", { name: "Run design experiment" }),
  ).toBeEnabled();
});

test("an unavailable planner service gives a recoverable message instead of a JSON error", async ({
  page,
}) => {
  await page.route("**/planner-api/readiness", (route) =>
    route.fulfill({
      json: {
        liveReady: false,
        aiConfigured: false,
        renderStatus: "unavailable",
        catalogCount: 117,
        catalogSource: "bundled",
        message: "Try the catalog demo.",
      },
    }),
  );
  await page.route("**/planner-api/sessions", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "Bad gateway",
    }),
  );
  await page.goto("/?planner-lab");
  await page.getByLabel("Run mode").selectOption("demo");
  await page.getByRole("button", { name: "Run design experiment" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Check the connection and try again",
  );
  await expect(
    page.getByRole("button", { name: "Run design experiment" }),
  ).toBeEnabled();
});
