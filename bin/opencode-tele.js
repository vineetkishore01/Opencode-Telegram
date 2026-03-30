#!/usr/bin/env node

const path = require('path')
const fs = require('fs')

const distPath = path.join(__dirname, '..', 'dist', 'index.js')

if (!fs.existsSync(distPath)) {
  console.error('\n  ❌ Build output not found.')
  console.error('  Run the following first:\n')
  console.error('    npm install && npm run build\n')
  console.error('  Or reinstall globally:\n')
  console.error('    npm install -g opencode-tele\n')
  process.exit(1)
}

require(distPath)
