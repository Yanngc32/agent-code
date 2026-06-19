// Rasterizes build/icon.svg into the app icons using the already-installed
// Playwright Chromium (no extra image dependency). Run with: npm run icon
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = resolve(here, '..', 'build')
mkdirSync(buildDir, { recursive: true })

const svg = readFileSync(resolve(buildDir, 'icon.svg'), 'utf8')

async function render(size) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const html =
    `<!doctype html><meta charset="utf-8">` +
    `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;background:transparent;overflow:hidden}` +
    `svg{width:${size}px;height:${size}px;display:block}</style>` +
    svg
  await page.setContent(html, { waitUntil: 'networkidle' })
  const buf = await page.screenshot({ omitBackground: true, type: 'png' })
  await browser.close()
  return buf
}

// Minimal single-image .ico wrapping a 256px PNG (Windows accepts PNG entries).
function pngToIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(1, 4) // image count
  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0) // width  (0 means 256)
  entry.writeUInt8(0, 1) // height (0 means 256)
  entry.writeUInt8(0, 2) // palette
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8) // image data size
  entry.writeUInt32LE(6 + 16, 12) // offset of image data
  return Buffer.concat([header, entry, png])
}

const png512 = await render(512)
writeFileSync(resolve(buildDir, 'icon.png'), png512)

const png256 = await render(256)
writeFileSync(resolve(buildDir, 'icon.ico'), pngToIco(png256))

console.log('Ícones gerados: build/icon.png (512x512) e build/icon.ico (256x256)')
