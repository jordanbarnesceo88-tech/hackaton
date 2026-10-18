import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

test("admin product lifecycle and catalogue refresh preserve an explicit parameter edit", async ({ page }) => {
  test.setTimeout(120_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const name = `e2e-maintenance-${Date.now()}`;
  const hint = `${name}: проверенная подсказка`;
  let slug: string | undefined;
  const original = await db.paramDefinition.findFirstOrThrow({ where: { key: "forkliftSalaryRubMonth", facilityType: { slug: "warehouse" } } });
  try {
    page.on("dialog", dialog => void dialog.accept());
    await page.goto("/login");
    await page.locator("#email").fill("admin@demo.local");
    await page.locator("#password").fill(process.env.DEMO_ADMIN_PASSWORD ?? "demo-admin-2026");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);

    await page.goto("/admin/catalog");
    const create = page.getByRole("form", { name: "Создать продукт", exact: true });
    await create.locator("input[name=name]").fill(name);
    await create.locator("input[name=manufacturer]").fill("Тестовый производитель");
    await create.locator("input[name=country]").fill("Россия");
    await create.locator('input[name=process][value="pallet-transport"]').check();
    await create.getByRole("button", { name: "Создать продукт", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/catalog\/[^/?#]+$/);
    slug = new URL(page.url()).pathname.split("/").at(-1)!;
    expect((await db.catalogProduct.findUniqueOrThrow({ where: { slug } })).origin).toBe("ADMIN");
    expect((await page.request.get(`/catalog/${slug}`)).status()).toBe(200);

    const identity = page.getByRole("form", { name: "Идентификация продукта", exact: true });
    await identity.locator("input[name=country]").fill("Китай");
    await identity.getByRole("button", { name: "Сохранить идентификацию", exact: true }).click();
    await expect.poll(async () => (await db.catalogProduct.findUniqueOrThrow({ where: { slug } })).country).toBe("Китай");
    await page.getByRole("button", { name: "В архив", exact: true }).click();
    await expect(page.getByRole("button", { name: "Вернуть из архива", exact: true })).toBeVisible();
    // Archived detail URLs remain readable for saved-project references, while discovery hides them.
    const archived = await page.request.get(`/catalog/${slug}`);
    expect(archived.status()).toBe(200);
    expect((await archived.text()).includes("в архиве")).toBe(true);
    expect((await (await page.request.get(`/catalog?q=${encodeURIComponent(name)}`)).text()).includes(`/catalog/${slug}`)).toBe(false);
    await page.getByRole("button", { name: "Вернуть из архива", exact: true }).click();
    await expect(page.getByRole("button", { name: "В архив", exact: true })).toBeVisible();
    expect((await page.request.get(`/catalog/${slug}`)).status()).toBe(200);

    await page.goto("/admin/params?facility=warehouse");
    const row = page.getByRole("listitem").filter({ has: page.locator(`input[name=id][value="${original.id}"]`) });
    await row.getByText("Изменить", { exact: true }).click();
    await row.locator("textarea[name=hint]").fill(hint);
    await row.getByRole("button", { name: "Сохранить параметр", exact: true }).click();
    await expect.poll(async () => (await db.paramDefinition.findUniqueOrThrow({ where: { id: original.id } })).hint).toBe(hint);
    const definitions = await page.request.get("/api/v1/facility-types/warehouse/params");
    expect((await definitions.json()).params.find((p: { key: string }) => p.key === original.key).hint).toBe(hint);

    await page.goto("/admin/data");
    const refresh = page.getByRole("form", { name: "Обновить каталог", exact: true });
    await refresh.getByRole("button", { name: "Обновить каталог", exact: true }).click();
    await expect(refresh.getByRole("heading", { name: "Отчёт об обновлении", exact: true })).toBeVisible({ timeout: 60_000 });
    expect((await db.paramDefinition.findUniqueOrThrow({ where: { id: original.id } })).hint).toBe(hint);
    expect((await db.catalogProduct.findUniqueOrThrow({ where: { slug } })).country).toBe("Китай");
    await expect(page.getByRole("heading", { name: /Журнал/ }).first()).toBeVisible();

    await page.goto(`/admin/catalog/${slug}`);
    await page.getByLabel("Подтверждаю удаление", { exact: true }).check();
    await page.getByRole("button", { name: "Удалить продукт", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/catalog$/);
    expect(await db.catalogProduct.findUnique({ where: { slug } })).toBeNull();
    expect((await page.request.get(`/catalog/${slug}`)).status()).toBe(404);
  } finally {
    // Restore only this test's unique edit; never overwrite an intervening administrator edit.
    await db.paramDefinition.updateMany({ where: { id: original.id, hint }, data: { hint: original.hint, editedByAdmin: original.editedByAdmin } });
    await db.catalogProduct.deleteMany({ where: { name, origin: "ADMIN" } });
    await db.$disconnect();
  }
});
