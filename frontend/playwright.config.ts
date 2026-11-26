import fs from 'node:fs'
import { defineConfig } from '@playwright/test'

const systemChromium = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined
const executablePath = process.env.CHROMIUM_PATH || systemChromium

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://armando1424.github.io',
    headless: true,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
})
