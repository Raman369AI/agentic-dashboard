import { expect, test } from '@playwright/test'

test('discovers OpenAPI operations and a server-installed adapter without client changes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  async function connect(kind: string, name: string, url: string) {
    await page.getByRole('button', { name: /^Connections/ }).click()
    const drawer = page.getByRole('dialog', { name: 'Connections' })
    await drawer.getByLabel('Connection type').selectOption(kind)
    await drawer.getByLabel('Name', { exact: true }).fill(name)
    if (kind !== 'example.local') await drawer.getByLabel(kind === 'openapi' ? 'OpenAPI document URL' : 'Endpoint URL', { exact: true }).fill(url)
    await drawer.getByRole('button', { name: 'Add connection' }).click()
    await drawer.locator('article').filter({ hasText: name }).getByRole('button', { name: 'Use', exact: true }).click()
  }
  await connect('openapi', 'OpenAPI inventory', 'http://127.0.0.1:9101/openapi.json')
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('inventory')
  await page.getByRole('group', { name: 'path *' }).getByLabel('Region *', { exact: true }).fill('West')
  await page.getByRole('group', { name: 'query', exact: true }).getByLabel('Limit').fill('17')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.canvas-panel').getByRole('cell', { name: '17', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('semantic_query')
  await page.getByRole('group', { name: 'SemanticQuery *' }).getByLabel('Region *', { exact: true }).fill('South')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.canvas-panel').getByText(/Confirm this operation/)).toBeVisible()
  await page.getByRole('checkbox', { name: /Confirm POST operation/ }).check()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.canvas-panel').getByText('Revenue for', { exact: false }).first()).toContainText('South')

  await connect('example.semantic', 'Installed semantic adapter', 'http://127.0.0.1:9101/query')
  await expect(page.getByRole('combobox', { name: 'Operation', exact: true })).toHaveValue('query')
  await page.getByLabel('region *', { exact: true }).fill('Universal')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.canvas-panel').getByText('Revenue for', { exact: false }).first()).toContainText('Universal')
  await expect(page.locator('.canvas-panel').getByText('Quarterly revenue', { exact: true })).toBeVisible()
  await connect('example.local', 'Local semantic function', '')
  await page.getByLabel('x *', { exact: true }).fill('5')
  await page.getByLabel('y *', { exact: true }).fill('7')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.canvas-panel').getByText('Local total', { exact: true })).toBeVisible()
  await expect(page.locator('.canvas-panel').getByText('12', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('adapters.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('confirms each OpenAPI write used as an A2UI return channel', async ({ page }) => {
  const operation = 'http_form_a2ui_http_post'
  const response = await page.request.post('http://127.0.0.1:9100/api/connections', {
    data: {
      name: 'OpenAPI form', kind: 'openapi', url: 'http://127.0.0.1:9101/openapi.json',
      config: { a2ui_operation: operation },
    },
  })
  expect(response.status()).toBe(201)

  const prompts: string[] = []
  page.on('dialog', async (dialog) => { prompts.push(dialog.message()); await dialog.accept() })
  await page.goto('/')
  await page.getByRole('button', { name: /^Connections/ }).click()
  await page.getByRole('dialog', { name: 'Connections' }).locator('article')
    .filter({ hasText: 'OpenAPI form' }).getByRole('button', { name: 'Use' }).click()
  await page.getByRole('combobox', { name: 'Operation', exact: true }).selectOption(operation)
  await page.getByLabel('Query input (JSON)').fill(JSON.stringify({
    body: {
      messages: [], metadata: { a2uiRendererCapabilities: { 'v1.0': {
        supportedCatalogIds: ['https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'],
      } } },
    },
  }))
  await page.getByRole('checkbox', { name: /Confirm POST operation/ }).check()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const canvas = page.locator('.canvas-panel')
  await expect(canvas.getByRole('button', { name: 'Submit form' })).toBeVisible()
  await canvas.getByLabel('Your name').fill('Grace')
  await expect(canvas.getByText('Hello Grace')).toBeVisible()
  const beforeSubmit = prompts.length
  await canvas.getByRole('button', { name: 'Submit form' }).click()
  await expect(canvas.getByText('Saved Grace')).toBeVisible()
  expect(prompts.length).toBeGreaterThan(beforeSubmit)
  expect(prompts.every((prompt) => prompt.includes('Confirm POST operation'))).toBe(true)
})
