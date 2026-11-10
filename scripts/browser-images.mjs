/* global window, document, CanvasRenderingContext2D, requestAnimationFrame */
// Real packed-consumer browser proof. No simulated Python runtime or codec.
// Set PLAYWRIGHT_MODULE to a locally installed Playwright module if this repo
// does not install it, and start consumer-check's Vite preview beforehand.
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const moduleName = process.env.PLAYWRIGHT_MODULE || '@playwright/test'
const browsers = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName)
const base = process.env.IMAGE_FIXTURE_URL || 'http://127.0.0.1:4310/'
const output = path.resolve(process.env.IMAGE_EVIDENCE_DIR || '.artifacts/images')
await mkdir(output, { recursive: true })
const report = { platform: process.platform, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), results: [] }
const record = async result => {
  report.results.push(result)
  console.log(JSON.stringify(result))
  await writeFile(path.join(output, 'browser-images.json'), JSON.stringify(report, null, 2))
}
for (const name of (process.env.IMAGE_BROWSERS || 'chromium').split(',')) {
  const browser = await browsers[name].launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })
  await page.addInitScript(() => {
    window.rasterPaintTimes = []
    let queued = false
    const paint = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
      const result = paint.apply(this, args)
      if ((this.canvas.width === 50 || this.canvas.width === 100) && this.canvas.height === 50 && !queued) {
        queued = true
        requestAnimationFrame(time => { queued = false; window.rasterPaintTimes.push(time) })
      }
      return result
    }
  })
  page.on('pageerror', error => console.error(`${name} page error: ${error.message}`))
  const run = async (program, { debug = false, query = '', reload = true, timeout = 360000 } = {}) => {
    if (reload) await page.goto(`${base}?program=${program}${query}`)
    await page.getByRole('button', { name: debug ? 'Debug' : 'Run', exact: true }).waitFor({ timeout: 60000 })
    await page.evaluate(() => { window.imageFixtureEvents = []; window.rasterPaintTimes = [] })
    const started = Date.now()
    await page.getByRole('button', { name: debug ? 'Debug' : 'Run', exact: true }).click()
    if (debug) await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 120000 })
    await page.waitForFunction(() => window.imageFixtureEvents.some(event => event.type === 'program_exit'), undefined, { timeout })
    const events = await page.evaluate(() => window.imageFixtureEvents)
    const exit = events.find(event => event.type === 'program_exit')
    const stdout = events.filter(event => event.type === 'terminal_stdout').map(event => event.payload.text).join('')
    if (exit.payload.code !== 0) throw new Error(`${program} exited ${exit.payload.code}: ${stdout}`)
    return { browser: name, version: browser.version(), program, debug, wallSeconds: (Date.now() - started) / 1000, stdout }
  }
  try {
    if (process.env.IMAGE_BENCHMARK === 'stop') {
      await page.goto(`${base}?program=ghost_benchmark`)
      await page.getByRole('button', { name: 'Run', exact: true }).click({ timeout: 60000 })
      await page.waitForFunction(() => window.imageFixtureEvents.some(event => event.type === 'run'), undefined, { timeout: 120000 })
      await page.waitForTimeout(6000)
      const started = Date.now()
      await page.getByRole('button', { name: 'Stop', exact: true }).first().click()
      const acknowledgedMs = Date.now() - started
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Stop'), undefined, { timeout: 2000 })
      await record({ browser: name, program: 'ghost-stop-during-local-pixel-loop', acknowledgedMs, settledMs: Date.now() - started })
    } else if (process.env.IMAGE_BENCHMARK === 'brush') {
      await page.goto(`${base}?program=sand_starter`)
      await page.getByRole('button', { name: 'Run', exact: true }).click({ timeout: 60000 })
      const svg = page.getByRole('img', { name: 'Graphics canvas: Sand', exact: true })
      await svg.waitFor({ timeout: 120000 })
      const box = await svg.boundingBox()
      if (!box) throw new Error('Missing Sand canvas')
      await page.mouse.click(box.x + 5.5 / 50 * box.width, box.y + 5.5 / 50 * box.height)
      await page.waitForFunction(() => {
        const canvas = document.querySelector('foreignObject canvas')
        return canvas && Array.from(canvas.getContext('2d').getImageData(5, 5, 1, 1).data).join(',') === '235,190,65,255'
      }, undefined, { timeout: 5000 })
      await page.getByRole('radio', { name: 'BigErase', exact: true }).check()
      await page.mouse.click(box.x + 5.5 / 50 * box.width, box.y + 5.5 / 50 * box.height)
      await page.waitForFunction(() => {
        const canvas = document.querySelector('foreignObject canvas')
        return canvas && Array.from(canvas.getContext('2d').getImageData(5, 5, 1, 1).data).join(',') === '255,255,255,255'
      }, undefined, { timeout: 5000 })
      await page.getByRole('button', { name: 'Stop', exact: true }).first().click()
      await record({ browser: name, program: 'sand_starter', quickClick: true, bigEraseQuickClick: true })
    } else if (process.env.IMAGE_BENCHMARK === 'controls') {
      await page.goto(`${base}?program=controls`)
      await page.getByRole('button', { name: 'Run', exact: true }).click({ timeout: 60000 })
      const nameField = page.getByRole('textbox', { name: 'Name', exact: true })
      await nameField.fill('Hello', { timeout: 120000 })
      await nameField.press('Enter')
      await page.getByRole('checkbox', { name: 'Gravity', exact: true }).uncheck()
      await page.getByRole('slider', { name: 'Strength', exact: true }).press('End')
      await page.getByRole('radio', { name: 'Rock', exact: true }).check()
      await page.getByRole('button', { name: 'Submit controls', exact: true }).click()
      const box = await page.getByRole('img', { name: 'Graphics canvas: Native controls', exact: true }).boundingBox()
      if (!box) throw new Error('Missing canvas')
      await page.mouse.move(box.x + 50, box.y + 50)
      await page.mouse.down()
      await page.mouse.move(box.x - 30, box.y + 50, { steps: 5 })
      await page.mouse.up()
      await page.waitForFunction(() => window.imageFixtureEvents.some(event => event.type === 'program_exit'), undefined, { timeout: 30000 })
      const stdout = await page.evaluate(() => window.imageFixtureEvents.filter(event => event.type === 'terminal_stdout').map(event => event.payload.text).join(''))
      if (!stdout.includes('CONTROLS_PASS')) throw new Error(stdout)
      await record({ browser: name, program: 'controls', stdout })
    } else if (process.env.IMAGE_BENCHMARK === 'lifetimes') {
      const result = await run('image_lifetimes', { timeout: 360000 })
      if (!result.stdout.includes('IMAGE_LIFETIMES_PASS')) throw new Error('Missing lifetime proof marker')
      const pixels = await page.locator('canvas').evaluateAll(nodes => nodes.filter(node => node.width === 1 && node.height === 1).map(node => Array.from(node.getContext('2d').getImageData(0, 0, 1, 1).data)))
      if (pixels.map(pixel => pixel.join(',')).join(';') !== '255,0,0,255;0,0,255,255') throw new Error(`Wrong retained revisions: ${pixels}`)
      await record({ ...result, pixels })
    } else if (process.env.IMAGE_BENCHMARK === 'ghost') {
      for (let repeat = 0; repeat < Number(process.env.IMAGE_RUNS || 1); repeat++) {
        await record({ ...await run('ghost_benchmark', { reload: repeat === 0 }), repeat })
      }
    } else if (process.env.IMAGE_BENCHMARK === 'sand') {
      for (const width of (process.env.IMAGE_WIDTHS || '50,100').split(',')) {
        for (let repeat = 0; repeat < Number(process.env.IMAGE_RUNS || 1); repeat++) {
          const result = await run('sand_benchmark', { query: `&width=${width}&duration=60`, reload: repeat === 0, timeout: 180000 })
          const times = await page.evaluate(() => window.rasterPaintTimes)
          const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b)
          await record({ ...result, width: Number(width), repeat, presentedFrames: times.length,
            presentedFps: (times.length - 1) * 1000 / (times.at(-1) - times[0]),
            p95PresentedIntervalMs: intervals[Math.floor(intervals.length * 0.95)] })
        }
      }
    } else {
      for (const debug of [false, true]) {
        const result = await run('image_inputs', { debug })
        if (!result.stdout.includes('BINARY_IMAGE_PIPELINE_PASS')) throw new Error('Missing image proof marker')
        const pixels = await page.locator('canvas').evaluateAll(nodes => nodes.filter(node => node.width === 8 && node.height === 6).map(node => Array.from(node.getContext('2d').getImageData(0, 0, 1, 1).data)))
        if (pixels[0]?.join(',') !== '0,0,255,255' || pixels[1]?.join(',') !== '254,0,0,255') throw new Error(`Wrong composite pixels: ${pixels}`)
        const downloaded = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Download PNG', exact: true }).nth(1).click()
        await (await downloaded).saveAs(path.join(output, `${name}-${debug ? 'debug' : 'run'}-composite.png`))
        await record({ ...result, pixels, download: true })
      }
      for (let repeat = 0; repeat < Number(process.env.IMAGE_CYCLES || 1); repeat++) {
        const result = await run('image_contract', { reload: repeat === 0 })
        if (!result.stdout.includes('IMAGE_CONTRACT_PASS')) throw new Error('Missing sprite proof marker')
        if (await page.getByRole('button', { name: 'Download PNG', exact: true }).count() !== 2) throw new Error('Gallery retained a prior generation')
        await record({ ...result, repeat })
      }
      await page.screenshot({ path: path.join(output, `${name}-images.png`), fullPage: true })
    }
  } finally { await browser.close() }
}
