import { expect, test } from "@playwright/test";

test("two browsers can create, join, ready and start", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  await pageA.goto("/");
  const cardBox = await pageA.locator(".card").boundingBox();
  const colorBoxes = await pageA.getByRole("button", { name: "Elegir color" }).evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right };
    })
  );
  expect(cardBox).not.toBeNull();
  for (const colorBox of colorBoxes) {
    expect(colorBox.left).toBeGreaterThanOrEqual(cardBox!.x);
    expect(colorBox.right).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
  }
  await pageA.getByLabel("Tu nombre").fill("Luna");
  await pageA.getByRole("button", { name: "Elegir color" }).nth(1).click();
  await expect(pageA.getByLabel("Tu nombre")).toHaveValue("Luna");
  await pageA.getByRole("button", { name: "Crear sala" }).click();
  const code = (await pageA.locator(".room-code").textContent())!.trim();
  await pageB.goto("/");
  await pageB.getByLabel("Tu nombre").fill("Sol");
  await expect(pageB.getByLabel("Código de sala")).toHaveCount(0);
  await pageB.getByRole("button", { name: "Unirme" }).click();
  await pageB.getByLabel("Código de sala").fill(code);
  await pageB.getByRole("button", { name: "Entrar" }).click();
  await expect(pageA.locator(".player-row")).toHaveCount(2);
  await pageA.getByRole("button", { name: "Estoy listo" }).click();
  await pageB.getByRole("button", { name: "Estoy listo" }).click();
  await pageA.getByRole("button", { name: "Iniciar" }).click();
  await expect(pageA.locator("#hud")).toBeVisible();
  await expect(pageB.locator("#hud")).toBeVisible();
  await expect(pageA.locator("#shell")).toBeHidden();
  await expect(pageB.locator("#shell")).toBeHidden();
  await a.close();
  await b.close();
});
