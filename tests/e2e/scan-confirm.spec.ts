import { expect, test, type Page } from "@playwright/test";

// Render a plain ingredient label to a PNG so the upload path has a real image.
async function labelPng(page: Page): Promise<Buffer> {
  await page.setContent(`
    <div id="label" style="width:900px;padding:40px;background:#fff;color:#000;font:34px/1.5 Arial">
      <b>INGREDIENTS:</b> Wheat flour, sugar, palm oil, cocoa powder 6%, salt, emulsifier (INS 322).
      <br><b>Contains:</b> wheat, soy.
    </div>`);
  return page.locator("#label").screenshot();
}

test("live camera shows the guide frame and capture button", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture this part of the label" })).toBeEnabled();
  await expect(page.getByRole("status").first()).not.toHaveText("Starting camera…");
});

test("photo upload is read and can be confirmed", async ({ page }) => {
  const png = await labelPng(page);
  await page.goto("/scan");
  await page.locator('input[type=file][multiple]').setInputFiles({ name: "label.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Label part 1")).toBeVisible();

  await page.getByRole("button", { name: /Read label from 1 photo/ }).click();
  await expect(page).toHaveURL(/\/confirm$/, { timeout: 90_000 });

  await expect(page.getByRole("heading", { name: "Check the ingredients" })).toBeVisible();
  for (const name of ["sugar", "palm oil", "salt"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name}\\b`, "i") }).first()).toBeVisible();
  }
  await page.getByRole("button", { name: "This matches the label" }).click();
  await expect(page.getByText("Ingredient list confirmed.")).toBeVisible();
});

test("typed list can be edited before confirming", async ({ page }) => {
  await page.goto("/scan");
  await page.getByRole("button", { name: /Type the ingredients instead/ }).click();
  await page.getByLabel("Type or paste the ingredient list").fill(
    "Ingredients: sugr, chocolate (cocoa butter, milk solids), salt. May contain peanuts.",
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/confirm$/);

  await page.getByRole("button", { name: /^sugr\. Tap to edit/ }).click();
  await page.getByLabel("Edit sugr").fill("sugar");
  await page.getByLabel("Edit sugr").press("Enter");
  await page.getByRole("button", { name: "Remove salt" }).click();
  await page.getByLabel("Add a missed ingredient").fill("Emulsifier (471)");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();

  await expect(page.getByRole("button", { name: /^milk solids\. Tap to edit/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^May contain peanuts/ })).toBeVisible();

  await page.getByRole("button", { name: "This matches the label" }).click();
  await page.getByText("Show data").click();
  const data = JSON.parse(await page.locator("pre").innerText());
  expect(data.ingredients.map((i: { canonical: string }) => i.canonical)).toEqual(["sugar", "chocolate", "emulsifier"]);
  expect(data.ingredients[2].codes).toEqual(["INS 471", "E471"]);
});
