// End-to-end smoke test: drives the built app through the whole demo flow.
//   npm run build && node e2e/demo-flow.mjs [screenshotDir]
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shots = process.argv[2]
if (shots) mkdirSync(shots, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'contacts-aligner-e2e-'))

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.setViewportSize({ width: 1440, height: 920 })
const snap = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`) })
const step = async (name, fn) => {
  process.stdout.write(`• ${name}… `)
  await fn()
  await page.waitForTimeout(900)
  await snap(name)
  console.log('ok')
}

await step('01-welcome', () => page.getByText('Contacts Aligner', { exact: true }).waitFor())
await step('02-sources', async () => {
  await page.getByRole('button', { name: /demo data/i }).click()
  await page.getByText('Where do your contacts live?').waitFor()
})
await step('03-summary', async () => {
  await page.getByRole('button', { name: /^Summary/ }).click()
  await page.getByText('What we found').waitFor()
})
await step('04-preview-duplicates', async () => {
  await page.getByRole('button', { name: /Preview Alignment Options/ }).click()
  await page.getByText('Alignment preview').waitFor({ timeout: 30000 })
})
await step('05-preview-emails', () => page.getByRole('button', { name: 'Emails', exact: true }).click())
await step('06-preview-calls', () => page.getByRole('button', { name: /Phones · Calls/ }).click())
await step('07-preview-messages', () => page.getByRole('button', { name: /Phones · Messages/ }).click())
await step('08-autocomplete', () => page.getByRole('button', { name: /Mail Autocomplete/ }).click())
await step('09-destination', async () => {
  await page.getByRole('button', { name: /Choose destination/ }).click()
  await page.getByRole('button', { name: /Select all/ }).click()
})
await step('10-review', async () => {
  await page.getByRole('button', { name: /Review changes/ }).click()
  await page.getByText('Review before pushing').waitFor()
})
await step('11-pushed', async () => {
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Push changes/ }).click()
  await page.getByText('Contacts aligned').waitFor({ timeout: 30000 })
})
await step('12-undone', async () => {
  await page.getByRole('button', { name: /Undo this push/ }).click()
  await page.getByText('Push undone').waitFor({ timeout: 30000 })
})

await app.close()
if (errors.length) {
  console.error('Renderer errors:\n' + errors.join('\n'))
  process.exit(1)
}
console.log('Demo flow passed')
