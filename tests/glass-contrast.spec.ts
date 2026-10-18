import { expect, test } from "@playwright/test";
test("keeps secondary room text legible across lighting presets", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Room inspector" });
  await expect(panel).toBeVisible();
  for (const label of ["Golden hour", "Daylight", "Evening"]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^Lighting: ${label}`) }),
    ).toBeVisible();
    const contrast = await panel.evaluate((panel) => {
      const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      const foreground = rgb(
          getComputedStyle(panel.querySelector(".subtle")!).color,
        ),
        fill = rgb(getComputedStyle(panel).backgroundColor),
        hex = getComputedStyle(document.documentElement)
          .getPropertyValue("--backdrop")
          .trim()
          .slice(1);
      const backdrop = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const alpha = fill[3] ?? 1,
        bg = backdrop.map((n, i) => fill[i] * alpha + n * (1 - alpha));
      const luminance = (color: number[]) =>
        color
          .slice(0, 3)
          .map((n) => {
            const c = n / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
      const a = luminance(foreground),
        b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast, `${label} secondary text contrast`).toBeGreaterThanOrEqual(
      4.5,
    );
    if (label !== "Evening")
      await page
        .getByRole("button", { name: new RegExp(`^Lighting: ${label}`) })
        .click();
  }
});
