import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  version: vi.fn(),
  set: vi.fn(),
}))

vi.mock('../../src/api/cache', () => ({
  cacheTtl: 10 * 60_000,
  loadCache: () => ({
    get: () => ({
      data: ['1.0.0'],
      expiresAt: Date.now() - 1,
    }),
    set: mocks.set,
    delete: vi.fn(),
  }),
  dumpCache: vi.fn(),
}))

vi.mock('../../src/api/version', () => ({
  version: mocks.version,
}))

import { getPackageData } from '../../src/api'
import type Item from '../../src/core/Item'

const item = {
  key: 'stale-package',
  value: '1.0.0',
  registry: 'npm',
} as Item

describe('stale-while-revalidate cache', () => {
  beforeEach(() => {
    mocks.version.mockReset()
    mocks.set.mockClear()
  })

  it('serves an expired entry immediately and revalidates in the background', async () => {
    mocks.version.mockResolvedValue(['2.0.0'])

    const result = await getPackageData(item, 'C:\\workspace')

    expect(result.version).toEqual(['1.0.0'])
    expect(mocks.version).toHaveBeenCalledOnce()

    await expect(result.refreshed).resolves.toEqual({ version: ['2.0.0'] })
    expect(mocks.set).toHaveBeenCalledWith(
      'npm:stale-package',
      expect.objectContaining({ data: ['2.0.0'] }),
    )
  })

  it('keeps the stale data when the background revalidation fails', async () => {
    mocks.version.mockResolvedValue(null)

    const result = await getPackageData(item, 'C:\\workspace')

    expect(result.version).toEqual(['1.0.0'])
    await expect(result.refreshed).resolves.toBeUndefined()
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
