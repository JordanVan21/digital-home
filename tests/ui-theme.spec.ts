import { expect, test } from "@playwright/test";

test("switches neutral frosted themes independently of room lighting and remembers the choice", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const root = page.locator("html");
  await expect(page.getByRole("switch", { name: "Measurements" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /^Edit log/ })).toHaveCount(0);
  const add = page.getByRole("button", {
    name: "Open furniture library",
    exact: true,
  });
  await expect(add).toHaveCSS("background-color", "rgba(28, 28, 28, 0.7)");
  await expect(add).toHaveCSS("backdrop-filter", "blur(26px) saturate(1.6)");
  await expect(root).toHaveAttribute("data-ui-theme", "light");
  await expect(
    page.getByRole("complementary", { name: "Room inspector" }),
  ).toHaveCSS("background-color", "rgba(255, 255, 255, 0.68)");
  await expect(
    page.getByRole("complementary", { name: "Room inspector" }),
  ).toHaveCSS("backdrop-filter", "blur(26px) saturate(1.6)");
  await page.screenshot({ path: "/tmp/house-glass-light-initial.png" });
  const lighting = await root.getAttribute("data-lighting");
  await page.getByRole("button", { name: "Switch to dark panels" }).click();
  await expect(root).toHaveAttribute("data-ui-theme", "dark");
  await expect(root).toHaveAttribute("data-lighting", lighting!);
  const colors = await root.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      fill: style.getPropertyValue("--glass-fill"),
      ink: style.getPropertyValue("--ink"),
    };
  });
  expect(colors.fill).toContain("28, 28, 28");
  expect(colors.ink.trim()).toBe("#f5f5f5");
  await expect(add).toHaveCSS("background-color", "rgba(255, 255, 255, 0.6)");
  const boxes = page.getByRole("button", {
    name: "Bounding boxes",
    exact: true,
  });
  await boxes.click();
  await page.mouse.move(720, 900);
  await expect(boxes).toHaveCSS("background-color", "rgba(255, 255, 255, 0.6)");
  await boxes.click();
  await page.mouse.move(720, 900);
  await expect(
    page.getByRole("button", { name: "Switch to light panels" }),
  ).toHaveCSS("background-color", "rgba(28, 28, 28, 0.7)");
  await page.screenshot({ path: "/tmp/house-glass-dark.png" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(root).toHaveAttribute("data-ui-theme", "dark");
  await page.getByRole("button", { name: "Switch to light panels" }).click();
  await expect(root).toHaveAttribute("data-ui-theme", "light");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/house-glass-light.png" });
});
