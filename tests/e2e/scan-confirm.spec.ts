import { expect, test } from "@playwright/test";
import path from "node:path";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);

test("live camera shows the guide frame and capture button", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture this part of the label" })).toBeEnabled();
});

test("clear photo: quality check, cross-checked reading, confirm", async ({ page }) => {
  await page.goto("/scan");
  await page.locator("input[type=file][multiple]").setInputFiles(fixture("label-clean.jpg"));
  await expect(page.getByText("Photo 1")).toBeVisible();
  await expect(page.getByText("Clear", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Read label from 1 photo/ }).click();
  await expect(page).toHaveURL(/\/confirm$/, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Check what was read" })).toBeVisible();

  for (const name of ["Wheat Flour", "Sugar", "Palm Oil", "Iodised Salt", "Emulsifier (322)"]) {
    await expect(page.getByRole("button", { name: `${name}. Tap to edit` })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "CONTAINS: WHEAT, SOY. Tap to edit" })).toBeVisible();
  await expect(page.getByText("Allergen information may be incomplete")).toHaveCount(0);

  // Provenance: the item can be located on the photo.
  await page.getByRole("button", { name: "Show on photo" }).first().click();
  await expect(page.getByRole("img", { name: /Where "Wheat Flour" was read/ })).toBeVisible();

  await page.getByRole("button", { name: "This matches the label" }).click();
  await expect(page.getByText("Ingredient list confirmed.")).toBeVisible();
});

test("glare photo: allergen warning and the hidden part must be acknowledged", async ({ page }) => {
  await page.goto("/scan");
  await page.locator("input[type=file][multiple]").setInputFiles(fixture("label-glare.jpg"));
  await page.getByRole("button", { name: /Read label from 1 photo/ }).click();
  await expect(page).toHaveURL(/\/confirm$/, { timeout: 120_000 });

  await expect(page.getByText("Allergen information may be incomplete")).toBeVisible();
  await expect(page.getByText(/Glare covers part of photo 1/).first()).toBeVisible();
  const confirmBtn = page.getByRole("button", { name: "This matches the label" });
  await expect(confirmBtn).toBeDisabled();

  // Resolve: acknowledge each gap; fix or remove each disputed line.
  for (const box of await page.getByLabel("I've checked this part on the pack").all()) await box.check();
  for (let i = 0; i < 20 && (await confirmBtn.isDisabled()); i++) {
    const right = page.getByRole("button", { name: /is right$/ }).first();
    if (await right.count()) await right.click();
    else break;
  }
  await expect(confirmBtn).toBeEnabled();
});

test("typed list can be edited before confirming", async ({ page }) => {
  await page.goto("/scan");
  await page.getByRole("button", { name: /Type the ingredients instead/ }).click();
  await page.getByLabel("Type or paste the ingredient list").fill("Ingredients: sugr, chocolate (cocoa butter, milk solids), salt. May contain peanuts.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/confirm$/);

  await page.getByRole("button", { name: "sugr. Tap to edit" }).click();
  await page.getByLabel("Edit sugr").fill("sugar");
  await page.getByLabel("Edit sugr").press("Enter");
  await expect(page.getByRole("button", { name: "sugar. Tap to edit" })).toBeVisible();
  await page.getByRole("button", { name: "Remove salt" }).click();
  await expect(page.getByRole("button", { name: /^May contain peanuts.*Tap to edit$/ })).toBeVisible();
  await page.getByRole("button", { name: "This matches the label" }).click();
  await expect(page.getByText("Ingredient list confirmed.")).toBeVisible();
});
