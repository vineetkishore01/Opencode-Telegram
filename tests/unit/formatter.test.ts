import { describe, it, expect } from 'vitest'

describe('Formatter Utilities', () => {
  it('should strip ANSI escape codes', () => {
    const { stripAnsi } = await import('../src/utils/formatter.js')
    expect(stripAnsi('\x1B[31mred\x1B[0m text')).toBe('red text')
  })

  it('should escape markdown characters', () => {
    const { escapeMarkdown } = await import('../src/utils/formatter.js')
    expect(escapeMarkdown('test*bold*')).toBe('test\\*bold\\*')
  })

  it('should split messages at newlines within limit', () => {
    const { splitMessage } = await import('../src/utils/formatter.js')
    const chunks = splitMessage('line1\nline2\nline3', 10)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('should return correct file icon for extensions', () => {
    const { getFileIcon } = await import('../src/utils/formatter.js')
    expect(getFileIcon('test.ts')).toBe('📘')
    expect(getFileIcon('test.py')).toBe('🐍')
    expect(getFileIcon('test.md')).toBe('⭐')
    expect(getFileIcon('unknown.xyz')).toBe('📄')
  })
})
