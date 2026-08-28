import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Item from '../../src/core/Item'

const mocks = vi.hoisted(() => ({
  getPackageData: vi.fn(),
  statusBarItem: {
    setText: vi.fn(),
  },
}))

vi.mock('vscode', () => ({
  CompletionItem: class {
    preselect?: boolean
    sortText?: string
    constructor(public label: string) {}
  },
  CompletionItemKind: { Class: 4 },
  CompletionList: class {
    constructor(public items: unknown[], public incomplete = false) {}
  },
}))

vi.mock('../../src/providers/autoCompletion', () => ({
  sortText: (index: number) => String(index).padStart(6, '0'),
}))

vi.mock('../../src/ui/indicators', () => ({
  statusBarItem: mocks.statusBarItem,
}))

vi.mock('../../src/api', () => ({
  getPackageData: mocks.getPackageData,
}))

import { fetchPackageVersions } from '../../src/core/fetcher'

function makeItem(key: string) {
  return {
    key,
    value: '^1.0.0',
    registry: 'npm',
  } as Item
}

describe('progressive package fetching', () => {
  beforeEach(() => {
    mocks.getPackageData.mockReset()
    mocks.statusBarItem.setText.mockClear()
  })

  it('reports an update as soon as each dependency settles', async () => {
    const fast = makeItem('fast')
    const slow = makeItem('slow')

    let releaseSlow: () => void = () => {}
    const slowGate = new Promise<void>(resolve => {
      releaseSlow = resolve
    })

    mocks.getPackageData.mockImplementation((item: Item) =>
      item.key === 'fast'
        ? Promise.resolve({ version: ['2.0.0', '1.5.0', '1.0.0'] })
        : slowGate.then(() => ({ version: ['1.1.0'] })))

    const updates: Array<{ settled: number, total: number, versions: Array<string[] | undefined> }> = []
    const done = fetchPackageVersions([fast, slow], 'C:\\workspace', false, (deps, settled, total) => {
      updates.push({
        settled,
        total,
        versions: deps.map(dep => dep.versions),
      })
    })

    // Let the fast dependency settle before releasing the slow one.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(updates.length).toBeGreaterThanOrEqual(1)
    const intermediate = updates.at(-1)!
    expect(intermediate.settled).toBe(1)
    expect(intermediate.total).toBe(2)
    expect(intermediate.versions[0]).toEqual(['2.0.0', '1.5.0', '1.0.0'])
    expect(intermediate.versions[1]).toBeUndefined()

    releaseSlow()
    const [responses, responsesMap] = await done

    expect(updates.at(-1)!.settled).toBe(2)
    expect(responses.map(dep => dep.versions)).toEqual([
      ['2.0.0', '1.5.0', '1.0.0'],
      ['1.1.0'],
    ])
    expect(responsesMap.get('slow')?.[0].versions).toEqual(['1.1.0'])
  })

  it('resolves immediately without updates when there is nothing to fetch', async () => {
    const onUpdate = vi.fn()

    const [responses, responsesMap] = await fetchPackageVersions([], 'C:\\workspace', false, onUpdate)

    expect(responses).toEqual([])
    expect(responsesMap.size).toBe(0)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
