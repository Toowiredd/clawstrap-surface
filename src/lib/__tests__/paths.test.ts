import { describe, it, expect } from 'vitest'
import { resolveWithin } from '../paths'
import path from 'node:path'

describe('resolveWithin', () => {
  const base = path.resolve('/tmp/sandbox')

  it('resolves a simple relative path within base', () => {
    const result = resolveWithin(base, 'file.txt')
    expect(result).toBe(path.resolve(base, 'file.txt'))
  })

  it('resolves nested relative path', () => {
    const result = resolveWithin(base, 'subdir/file.txt')
    expect(result).toBe(path.resolve(base, 'subdir/file.txt'))
  })

  it('throws when path escapes base with ..', () => {
    expect(() => resolveWithin(base, '../escape.txt')).toThrow('Path escapes base directory')
  })

  it('throws when path tries deep escape', () => {
    expect(() => resolveWithin(base, '../../etc/passwd')).toThrow('Path escapes base directory')
  })

  it('throws for absolute path outside base', () => {
    expect(() => resolveWithin(base, path.resolve('/etc/passwd'))).toThrow('Path escapes base directory')
  })

  it('allows an absolute path within the base', () => {
    const allowedPath = path.resolve(base, 'file.txt')
    const result = resolveWithin(base, allowedPath)
    expect(result).toBe(allowedPath)
  })

  it('handles double slashes and normalizes', () => {
    const result = resolveWithin(base, 'subdir//file.txt')
    expect(result).toBe(path.resolve(base, 'subdir/file.txt'))
  })

  it('does not allow sibling directory access', () => {
    expect(() => resolveWithin(base, '../other/file.txt')).toThrow()
  })

  it('handles base dir with trailing slash', () => {
    const trailingBase = `${base}${path.sep}`
    const result = resolveWithin(trailingBase, 'file.txt')
    expect(result).toBe(path.resolve(base, 'file.txt'))
  })
})
