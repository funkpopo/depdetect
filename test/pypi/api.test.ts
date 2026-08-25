import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('../../src/api/request', () => ({ requestJson: mocks.requestJson }))

import { pypiVersions } from '../../src/api/pypi'

describe('PyPI API', () => {
  beforeEach(() => mocks.requestJson.mockReset())

  it('returns releases that have at least one non-yanked file', async () => {
    mocks.requestJson.mockResolvedValue({
      releases: {
        '2.0.0': [{ yanked: false }],
        '1.9.0': [{ yanked: true }],
        '1.8.0': [{ yanked: false }, { yanked: true }],
      },
    })

    await expect(pypiVersions('example package')).resolves.toEqual(['2.0.0', '1.8.0'])
    expect(mocks.requestJson).toHaveBeenCalledWith('https://pypi.org/pypi/example%20package/json')
  })

})
