import { MessageInfo, MessagePart, PermissionRequest } from '../types/index.js'

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

export function formatForTelegram(text: string): string {
  if (!text) return ''

  const parts = text.split(/(```[\s\S]*?```|`[^`]*?`)/g)

  for (let i = 0; i < parts.length; i += 2) {
    let part = parts[i]

    // Convert GFM bold to Telegram bold
    part = part.replace(/\*\*(.*?)\*\*/g, '*$1*')

    // Escape underscores
    part = part.replace(/_/g, '\\_')

    // Convert markdown lists to bullet points
    part = part.replace(/^\s*\*\s+/gm, '• ')

    // Convert headers to bold
    part = part.replace(/^#+ (.*?)$/gm, '*$1*')

    parts[i] = part
  }

  return parts.join('')
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

export function escapeMarkdownInCode(text: string): string {
  return text.replace(/([`\\])/g, '\\$1')
}

export function escapeMarkdownSafe(text: string): string {
  const escaped = escapeMarkdown(text)
  return escaped.length > 4096 ? escaped.substring(0, 4090) + '...' : escaped
}

// Add sentence breaks for readability
export function breakSentences(text: string): string {
  // Preserve code blocks
  const parts = text.split(/(```[\s\S]*?```|`[^`]*?`)/g)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].replace(/([.!?])\s+/g, '$1\n')
  }
  return parts.join('')
}

// Ensure proper paragraph spacing
export function ensureParagraphSpacing(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`]*?`)/g)
  for (let i = 0; i < parts.length; i += 2) {
    // Replace single newlines with double (for paragraphs)
    parts[i] = parts[i].replace(/([^\n])\n([^\n])/g, '$1\n\n')
    // Collapse triple+ newlines to double
    parts[i] = parts[i].replace(/\n{3,}/g, '\n\n')
  }
  return parts.join('')
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

export function formatMessageSummary(info: MessageInfo): string {
  const tokens = info.tokens
    ? `Tokens: ${info.tokens.input} in, ${info.tokens.output} out, ${info.tokens.reasoning} reasoning`
    : ''
  const cost = info.cost ? `Cost: $${info.cost.toFixed(4)}` : ''

  return (
    `*Response Complete*\n\n` +
    (tokens ? `${tokens}\n` : '') +
    (cost ? `${cost}` : '')
  ).trim()
}

export function formatMessageParts(parts: MessagePart[]): string {
  let result = ''

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        if (part.text) {
          result += `${formatForTelegram(part.text)}\n\n`
        }
        break
      case 'reasoning':
        if (part.text) {
          result += `*Thinking:*\n${formatForTelegram(part.text)}\n\n`
        }
        break
      case 'tool':
        if (part.tool) {
          result += `*Tool: ${escapeMarkdown(part.tool)}*\n`
        }
        break
      case 'step-finish':
        result += `*Step Completed*\n`
        break
    }
  }

  return result.trim()
}

export function splitMessage(text: string, maxLength = 4096): string[] {
  const chunks: string[] = []
  let currentChunk = ''

  const lines = text.split('\n')

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk)
      }
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
