#!/usr/bin/env node

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const distPath = join(__dirname, '..', 'dist', 'index.js')

if (!existsSync(distPath)) {
  console.error('\n  ❌ Build output not found.')
  console.error('  Run the following first:\n')
  console.error('    npm install && npm run build\n')
  console.error('  Or reinstall globally:\n')
  console.error('    npm install -g opencode-tele\n')
  process.exit(1)
}

import(distPath).catch((error) => {
  console.error('Failed to start:', error.message)
  process.exit(1)
})
