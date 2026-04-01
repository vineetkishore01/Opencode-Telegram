import { PermissionRequest } from '../types/index.js'

// Strip ANSI escape codes from terminal output
export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

// Get emoji icon for file type
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const icons: Record<string, string> = {
    ts: '📘', js: '📜', tsx: '📘', jsx: '📜',
    py: '🐍', rb: '💎', go: '🔷', rs: '🦀',
    md: '⭐', txt: '📝', log: '📜',
    sh: '📜', bash: '📜', zsh: '📜',
    bat: '🔴', cmd: '🔴', exe: '🔴',
    json: '🧩', yaml: '🧩', yml: '🧩', toml: '🧩',
    env: '🔑',
    html: '🌐', css: '🎨', scss: '🎨',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️',
    pdf: '📕',
    docker: '🐳', dockerfile: '🐳',
    gitignore: '🟧', gitmodules: '🟧',
  }
  return icons[ext] || '📄'
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

export function formatPermissionRequest(permission: PermissionRequest): string {
  const patterns = permission.patterns.map((p: string) => `\`${escapeMarkdown(p)}\``).join(', ')

  return (
    `*Permission Request*\n\n` +
    `Permission: \`${escapeMarkdown(permission.permission)}\`\n` +
    `Patterns: ${patterns}\n\n` +
    `How would you like to respond?`
  )
}

export function splitMessage(text: string, maxLength = 4096): string[] {
  const chunks: string[] = []
  let currentChunk = ''

  const lines = text.split('\n')

  for (let line of lines) {
    // Handle extremely long lines by splitting them into smaller segments
    while (line.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk)
        currentChunk = ''
      }
      chunks.push(line.substring(0, maxLength))
      line = line.substring(maxLength)
    }

    if (currentChunk && currentChunk.length + line.length + 1 > maxLength) {
      chunks.push(currentChunk)
      currentChunk = line
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}
