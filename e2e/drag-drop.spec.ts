import { test, expect, type Page, type Route } from '@playwright/test'
import { createSigner } from 'fast-jwt'
import 'dotenv/config'

const JWT_SECRET = process.env['JWT_SECRET']
const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:3000'
const USER_ID = '6ead2e8e-fea6-452e-82ca-70fe04e03af8' // marco.andrade@elotech.com.br
const MENU_ID = '4e569d95-cd48-4371-b6a1-c3b6e3d5e3e3'
const ITEM_A = '3d15d9ed-6c32-40c3-ab14-544d680e644b'
const ITEM_B = '2ea74c45-5955-4c2c-9482-11e62fdbddd8'

if (!JWT_SECRET) throw new Error('JWT_SECRET ausente em .env')

const signer = createSigner({ key: JWT_SECRET })
const token = signer({ sub: USER_ID, email: 'marco.andrade@elotech.com.br' })

type Capturados = { urls: string[] }

async function setupPage(page: Page, capt: Capturados) {
  await page.context().addCookies([
    { name: 'genesis_admin_token', value: token, url: BASE_URL },
  ])

  // Intercepta endpoints mutativos para não tocar no banco
  const rota = async (route: Route) => {
    capt.urls.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  }
  await page.route('**/admin/menus/mover/item', rota)
  await page.route('**/admin/menus/copiar/item', rota)
  await page.route('**/admin/menus/atalho/item', rota)
  await page.route('**/admin/menus/reordenar/**', rota)

  await page.goto('/admin/menus')

  // Abre tudo da árvore programaticamente
  await page.waitForSelector('[data-sortable]')
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.tree-children').forEach((el) => {
      el.style.display = 'block'
    })
  })
}

async function centroVisivel(page: Page, selector: string) {
  const loc = page.locator(selector).first()
  await loc.scrollIntoViewIfNeeded()
  const box = await loc.boundingBox()
  if (!box) throw new Error(`bounding inexistente para ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function arrastar(page: Page, deId: string, modifiers: string[] = []) {
  const handleSel = `.mb-0[data-id="${deId}"] > .tree-row .dd-grip`
  const rowSel = `.mb-0[data-id="${deId}"] > .tree-row`
  const handle = await centroVisivel(page, handleSel)
  const row = await centroVisivel(page, rowSel)

  for (const m of modifiers) await page.keyboard.down(m)

  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  // SortableJS forceFallback precisa de vários mousemoves pra iniciar o drag.
  // Levar o ghost ao CENTRO da própria linha (posição válida, mesmo menu): o
  // grip fica na extrema direita da row; arrastar a partir dali pra fora da
  // coluna joga o ghost sobre o painel/zona de outro módulo e dispara o guard
  // "Bloqueado", mascarando o modo que o teste quer verificar.
  await page.mouse.move(row.x, handle.y, { steps: 5 })
  await page.mouse.move(row.x, row.y, { steps: 5 })
  await page.waitForTimeout(250)
}

async function soltar(page: Page, paraId: string, modifiers: string[] = []) {
  const targetSel = `.mb-0[data-id="${paraId}"] > .tree-row`
  const alvo = await centroVisivel(page, targetSel)
  await page.mouse.move(alvo.x, alvo.y + 4, { steps: 10 })
  await page.waitForTimeout(100)
  await page.mouse.up()
  for (const m of modifiers) await page.keyboard.up(m)
  await page.waitForTimeout(200)
}

async function lerIndicador(page: Page) {
  return await page.locator('#dd-modo-indicador').textContent()
}

test.describe('drag-and-drop com modifiers', () => {
  test('plain drop → mover (chama /mover/item)', async ({ page }) => {
    const capt: Capturados = { urls: [] }
    await setupPage(page, capt)

    await arrastar(page, ITEM_A)
    expect(await lerIndicador(page)).toMatch(/Mover/)
    await soltar(page, ITEM_B)

    expect(capt.urls.some((u) => u.endsWith('/mover/item'))).toBe(true)
    expect(capt.urls.some((u) => u.endsWith('/copiar/item'))).toBe(false)
    expect(capt.urls.some((u) => u.endsWith('/atalho/item'))).toBe(false)
  })

  test('Ctrl drop → copiar (chama /copiar/item, indicador azul)', async ({ page }) => {
    const capt: Capturados = { urls: [] }
    await setupPage(page, capt)

    await arrastar(page, ITEM_A, ['Control'])
    expect(await lerIndicador(page)).toMatch(/Copiar/)
    const cls = await page.locator('#dd-modo-indicador').getAttribute('class')
    expect(cls).toContain('copiar')
    await soltar(page, ITEM_B, ['Control'])

    expect(capt.urls.some((u) => u.endsWith('/copiar/item'))).toBe(true)
  })

  test('Alt drop → atalho (chama /atalho/item, indicador roxo)', async ({ page }) => {
    const capt: Capturados = { urls: [] }
    await setupPage(page, capt)

    await arrastar(page, ITEM_A, ['Alt'])
    expect(await lerIndicador(page)).toMatch(/Atalho/)
    const cls = await page.locator('#dd-modo-indicador').getAttribute('class')
    expect(cls).toContain('atalho')
    await soltar(page, ITEM_B, ['Alt'])

    expect(capt.urls.some((u) => u.endsWith('/atalho/item'))).toBe(true)
  })

  test('Shift+Ctrl → Shift vence, modo Mover', async ({ page }) => {
    const capt: Capturados = { urls: [] }
    await setupPage(page, capt)

    await arrastar(page, ITEM_A, ['Shift', 'Control'])
    expect(await lerIndicador(page)).toMatch(/Mover/)
    await soltar(page, ITEM_B, ['Shift', 'Control'])

    expect(capt.urls.some((u) => u.endsWith('/mover/item'))).toBe(true)
    expect(capt.urls.some((u) => u.endsWith('/copiar/item'))).toBe(false)
  })

  test('Shift+Alt → Shift vence, modo Mover', async ({ page }) => {
    const capt: Capturados = { urls: [] }
    await setupPage(page, capt)

    await arrastar(page, ITEM_A, ['Shift', 'Alt'])
    expect(await lerIndicador(page)).toMatch(/Mover/)
    await soltar(page, ITEM_B, ['Shift', 'Alt'])

    expect(capt.urls.some((u) => u.endsWith('/mover/item'))).toBe(true)
    expect(capt.urls.some((u) => u.endsWith('/atalho/item'))).toBe(false)
  })

  test('teclas mudam o indicador em tempo real durante o arraste', async ({ page }) => {
    const capt: Capturados = { urls: [] }
    await setupPage(page, capt)

    await arrastar(page, ITEM_A)
    expect(await lerIndicador(page)).toMatch(/Mover/)

    await page.keyboard.down('Control')
    await page.waitForTimeout(50)
    expect(await lerIndicador(page)).toMatch(/Copiar/)

    await page.keyboard.down('Alt')
    await page.waitForTimeout(50)
    // Alt+Ctrl: Alt tem prioridade sobre Ctrl → atalho
    expect(await lerIndicador(page)).toMatch(/Atalho/)

    await page.keyboard.down('Shift')
    await page.waitForTimeout(50)
    // Shift vence sobre Alt e Ctrl
    expect(await lerIndicador(page)).toMatch(/Mover/)

    await page.keyboard.up('Shift')
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    await soltar(page, ITEM_B)
  })
})
