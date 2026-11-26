import { expect, test } from "@playwright/test";

// The navbar brand is the logo mark followed by the "Rhizz" wordmark. The
// mark is a mask over currentColor, so what matters here is placement (left
// of the text, vertically aligned with it) and that it takes the text colour
// in both themes rather than staying black on a dark navbar.

test("navbar shows the logo left of the Rhizz text, aligned with it", async ({
  page,
}) => {
  await page.goto("/");
  const logo = page.getByTestId("navbar-logo");
  const brand = page.getByRole("link", { name: "Rhizz", exact: true });
  await expect(logo).toBeVisible();

  const logoBox = await logo.boundingBox();
  const brandBox = await brand.boundingBox();
  if (!logoBox || !brandBox) throw new Error("brand or logo not laid out");

  // Inside the brand link, ahead of the wordmark.
  expect(logoBox.x).toBeGreaterThanOrEqual(brandBox.x);
  const textBox = await brand.evaluate((el) => {
    const range = document.createRange();
    const text = [...el.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim() === "Rhizz",
    );
    if (!text) throw new Error("wordmark text node missing");
    range.selectNodeContents(text);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, height: r.height };
  });
  expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(textBox.x);

  // Vertically centred on the same line as the text.
  const logoMid = logoBox.y + logoBox.height / 2;
  const textMid = textBox.y + textBox.height / 2;
  expect(Math.abs(logoMid - textMid)).toBeLessThanOrEqual(2);
});

for (const theme of ["light", "dark"] as const) {
  test(`navbar logo follows the text colour in the ${theme} theme`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    const logo = page.getByTestId("navbar-logo");
    await expect(logo).toBeVisible();

    const colors = await page.evaluate(() => {
      const mark = document.querySelector('[data-testid="navbar-logo"]');
      const link = mark?.closest("a");
      if (!mark || !link) throw new Error("logo or brand link missing");
      return {
        mark: getComputedStyle(mark).backgroundColor,
        text: getComputedStyle(link).color,
        mask: getComputedStyle(mark).maskImage || "",
      };
    });
    expect(colors.mark).toBe(colors.text);
    expect(colors.mask).toContain("url(");
  });
}
