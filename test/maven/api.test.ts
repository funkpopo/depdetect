import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mavenVersions } from '../../src/api/maven'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('../../src/api/request', () => ({ requestJson: mocks.requestJson }))

describe('maven Central API', () => {
  beforeEach(() => mocks.requestJson.mockReset())

  it('queries by group and artifact and returns document versions', async () => {
    mocks.requestJson.mockResolvedValue({
      response: { docs: [{ v: '2.4.10' }, { v: '2.4.9' }] },
    })

    await expect(mavenVersions('io.milvus:milvus-sdk-java')).resolves.toEqual(['2.4.10', '2.4.9'])
    const [url] = mocks.requestJson.mock.calls[0]
    const parsedUrl = new URL(url)
    expect(parsedUrl.origin + parsedUrl.pathname).toBe('https://search.maven.org/solrsearch/select')
    expect(parsedUrl.searchParams.get('q')).toBe('g:"io.milvus" AND a:"milvus-sdk-java"')
    expect(parsedUrl.searchParams.get('core')).toBe('gav')
    expect(parsedUrl.searchParams.get('rows')).toBe('200')
    expect(parsedUrl.searchParams.get('wt')).toBe('json')
  })

  it('rejects malformed coordinates without making a request', async () => {
    await expect(mavenVersions('missing-artifact')).resolves.toBeNull()
    await expect(mavenVersions('org.example:bad artifact')).resolves.toBeNull()
    expect(mocks.requestJson).not.toHaveBeenCalled()
  })
})
