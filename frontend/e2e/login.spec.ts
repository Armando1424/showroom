import { expect, test } from '@playwright/test'

const accounts = [
  {
    username: 'local.administrator',
    password: process.env.E2E_ADMIN_PASSWORD,
    name: 'Administrador',
    admin: true,
  },
  {
    username: 'will',
    password: process.env.E2E_WILL_PASSWORD,
    name: 'Will',
    admin: true,
  },
  {
    username: 'cristian',
    password: process.env.E2E_CRISTIAN_PASSWORD,
    name: 'Cristian',
    admin: false,
  },
]

for (const account of accounts) {
  test(`login con ${account.username}`, async ({ page }) => {
    test.skip(!account.password, `Falta la contraseña E2E de ${account.username}`)

    await page.goto('/showroom/')
    await expect(page.getByRole('heading', { name: /Showroom/ })).toBeVisible()

    await page.getByLabel(/Correo o usuario/).fill(account.username)
    await page.getByLabel(/Contraseña/).fill(account.password!)
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(page.locator('.user-name')).toHaveText(account.name)
    await expect(page.locator('.user .badge').first()).toContainText(
      account.admin ? 'admin' : 'proveedor',
    )

    if (account.admin) {
      await expect(page.getByRole('link', { name: 'Usuarios' })).toBeVisible()
      await expect(page.getByLabel('Proveedor')).toBeVisible()
    } else {
      await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0)
      await expect(page.getByLabel('Proveedor')).toHaveCount(0)
    }

    await page.getByRole('link', { name: 'Productos' }).click()
    await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible()

    await page.getByRole('button', { name: 'Salir' }).click()
    await expect(page.getByLabel(/Correo o usuario/)).toBeVisible()
  })
}
