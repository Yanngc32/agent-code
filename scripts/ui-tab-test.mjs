// Drives the BUILT Electron app to verify the preview tab system end-to-end:
// open the browser, create two web tabs via the "+" menu, navigate each to a
// distinct page, switch between them, and confirm each tab shows its own page.
import { _electron as electron } from 'playwright'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = process.env.UI_OUT || tmpdir()
const shot = (n) => join(OUT, n)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Distinct, offline pages so the switch is visually unmistakable.
const page = (t, color) =>
  'data:text/html,' +
  encodeURIComponent(
    `<title>${t}</title><body style="margin:0;height:100vh;background:${color};color:#fff;` +
      `font:bold 96px system-ui;display:flex;align-items:center;justify-content:center">${t}</body>`
  )
const ALPHA = page('ALPHA', '#1f6feb')
const BETA = page('BETA', '#d9477e')

const log = (...a) => console.log('[ui-test]', ...a)

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Seed one conversation so there's an active browser, then reload to hydrate.
  await win.evaluate(() => {
    const conv = {
      id: 'c1', title: 'Teste UI', cwd: '.', model: 'claude-opus-4-8',
      sdkSessionId: null, messages: [], tokens: { context: 0, output: 0, cost: 0 },
      createdAt: 1, updatedAt: 2
    }
    localStorage.setItem('agentcode.conversations.v1', JSON.stringify([conv]))
    localStorage.setItem(
      'agentcode.ui.v1',
      JSON.stringify({ collapsed: false, activeId: 'c1', browserMinimized: false, browserWidth: 760 })
    )
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.tab-new', { timeout: 15000 })
  await sleep(800) // let setActiveBrowser('c1') reach main

  const tabCount = () => win.$$eval('.tab', (e) => e.length)
  // Click the real "+" → choose "Web" in the new-tab modal, then wait until the
  // new tab actually appears so the next navigate targets it, not the old tab.
  const openWebTab = async () => {
    const n0 = await tabCount()
    await win.click('.tab-new')
    await win.waitForSelector('.newtab-modal .newtab-option:not([disabled])')
    await win.click('.newtab-modal .newtab-option:not([disabled])') // first = Web
    await win.waitForFunction((n) => document.querySelectorAll('.tab').length === n + 1, n0, { timeout: 15000 })
  }
  // Navigate the active tab and wait until the active tab's name reflects it.
  const navActive = async (url, re) => {
    await win.evaluate((u) => window.api.navigate(u), url)
    await win.waitForFunction(
      (r) => new RegExp(r).test(document.querySelector('.tab.active .tab-name')?.textContent || ''),
      re.source,
      { timeout: 15000 }
    )
  }

  // --- Tab 1 → ALPHA ---
  await openWebTab()
  await navActive(ALPHA, /ALPHA/)
  log('after tab1 nav, tabs =', await win.$$eval('.tab .tab-name', (e) => e.map((x) => x.textContent)))

  // --- Tab 2 → BETA ---
  await openWebTab()
  await navActive(BETA, /BETA/)
  await sleep(600)
  const tabsBeta = await win.$$eval('.tab .tab-name', (e) => e.map((x) => x.textContent))
  const activeBeta = await win.$eval('.tab.active .tab-name', (e) => e.textContent)
  log('two tabs open, tabs =', tabsBeta)
  log('active tab =', activeBeta)
  await win.screenshot({ path: shot('ui-1-beta-active.png') })

  // --- Modal shows the kinds (web + android enabled, iphone reservado) ---
  await win.click('.tab-new')
  await win.waitForSelector('.newtab-modal')
  const menuItems = await win.$$eval('.newtab-modal .newtab-option', (els) =>
    els.map((e) => ({ label: e.textContent.replace(/\s+/g, ' ').trim(), disabled: e.hasAttribute('disabled') }))
  )
  log('new-tab modal =', JSON.stringify(menuItems))
  await win.screenshot({ path: shot('ui-2-newtab-modal.png') })
  await win.keyboard.press('Escape').catch(() => {}) // close modal

  // --- Switch back to the ALPHA tab by clicking it ---
  const switched = await win.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab')]
    const alpha = tabs.find((t) => /ALPHA/.test(t.textContent))
    if (!alpha) return 'ALPHA tab not found'
    alpha.click()
    return 'clicked ALPHA'
  })
  log('switch:', switched)
  await win
    .waitForFunction(() => /ALPHA/.test(document.querySelector('.tab.active .tab-name')?.textContent || ''), null, {
      timeout: 15000
    })
    .catch(() => {})
  await sleep(800)
  const activeAlpha = await win.$eval('.tab.active .tab-name', (e) => e.textContent)
  log('active tab after switch =', activeAlpha)
  await win.screenshot({ path: shot('ui-3-alpha-active.png') })

  // --- Verdict ---
  const ok =
    tabsBeta.length === 2 &&
    tabsBeta.some((t) => /ALPHA/.test(t)) &&
    tabsBeta.some((t) => /BETA/.test(t)) &&
    /BETA/.test(activeBeta) &&
    /ALPHA/.test(activeAlpha) &&
    menuItems.length === 3 &&
    menuItems.some((m) => /Web/i.test(m.label) && !m.disabled) &&
    menuItems.some((m) => /Android/i.test(m.label) && !m.disabled) &&
    menuItems.some((m) => /iPhone/i.test(m.label) && m.disabled)
  log('RESULT:', ok ? 'PASS' : 'FAIL')
  log('screens:', shot('ui-1-beta-active.png'), shot('ui-3-alpha-active.png'), shot('ui-2-newtab-modal.png'))
  process.exitCode = ok ? 0 : 1
} catch (err) {
  log('ERROR', err)
  process.exitCode = 1
} finally {
  await app.close()
}
