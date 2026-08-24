import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}))

import { dumpCache, loadCache } from '../../src/api/cache'

describe('version cache persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existsSync.mockReturnValue(true)
  })

  it('restores valid entries without extending their original expiration', () => {
    const expiresAt = Date.now() + 60_000
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      'npm:package': { data: ['1.0.0'], expiresAt },
    }))

    const cache = loadCache()

    expect(cache.get('npm:package')).toEqual({ data: ['1.0.0'], expiresAt })
  })

  it('drops expired and malformed entries while loading', () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      expired: { data: ['1.0.0'], expiresAt: Date.now() - 1 },
      malformed: { data: ['1.0.0'], expiresAt: 'later' },
      wrongData: { data: ['1.0.0', 2], expiresAt: Date.now() + 60_000 },
      valid: { data: ['2.0.0'], expiresAt: Date.now() + 60_000 },
    }))

    const cache = loadCache()

    expect([...cache.keys()]).toEqual(['valid'])
  })

  it('returns an empty cache when the persisted file is corrupt', () => {
    mocks.readFileSync.mockReturnValue('{broken json')

    expect(loadCache()).toEqual(new Map())
  })

  it('persists the original expiration timestamps', () => {
    const expiresAt = Date.now() + 60_000
    const cache = new Map([
      ['npm:package', { data: ['1.0.0'], expiresAt }],
    ])

    dumpCache(cache, true)

    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('depdetect'),
      JSON.stringify({ 'npm:package': { data: ['1.0.0'], expiresAt } }),
      'utf-8',
    )
  })
})
