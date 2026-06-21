// Probe: drive the built app and call window.api.newTab('android') to verify the
// full IPC → controller → Android path works and reports gracefully when the
// toolchain isn't installed. Does NOT download anything.
import { _electron as electron } from 'playwright'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[android-probe]', ...a)

const app = await electron.launch({ args: ['.'], cwd: process.cwd() })
try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    const conv = {
      id: 'c1', title: 'Android', cwd: '.', model: 'claude-opus-4-8',
      sdkSessionId: null, messages: [], tokens: { context: 0, output: 0, cost: 0 }, createdAt: 1, updatedAt: 2
    }
    localStorage.setItem('agentcode.conversations.v1', JSON.stringify([conv]))
    localStorage.setItem('agentcode.ui.v1', JSON.stringify({ collapsed: false, activeId: 'c1', browserMinimized: false, browserWidth: 720 }))
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('.tab-new', { timeout: 15000 })
  await sleep(800)

  // Collect any boot-progress lines the main process emits.
  await win.evaluate(() => {
    window.__androidLines = []
    window.api.onAndroidProgress((m) => window.__androidLines.push(m.line))
  })

  log('calling window.api.newTab("android")…')
  const res = await win.evaluate(() => window.api.newTab('android'))
  const lines = await win.evaluate(() => window.__androidLines || [])
  const tabs = await win.$$eval('.tab .tab-name', (e) => e.map((x) => x.textContent))

  log('newTab result:', JSON.stringify(res))
  log('progress lines:', JSON.stringify(lines))
  log('tabs in UI:', JSON.stringify(tabs))

  // Let the device screen stream + the device-frame resolution settle.
  await sleep(9000)
  const out = process.env.UI_OUT ? `${process.env.UI_OUT}/android-live.png` : 'android-live.png'
  await win.screenshot({ path: out })
  log('screenshot:', out)
} catch (err) {
  log('ERROR', err)
  process.exitCode = 1
} finally {
  await app.close()
}
