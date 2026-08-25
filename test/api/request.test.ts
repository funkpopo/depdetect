import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RegistryRequestError,
  requestJson,
  requestText,
  registryUserAgent,
} from '../../src/api/request'

const fetchMock = vi.fn()

describe('shared registry request layer', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the expected headers and parses JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ releases: {} }),
    })

    await expect(requestJson<{ releases: object }>('https://pypi.org/pypi/example/json')).resolves.toEqual({ releases: {} })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pypi.org/pypi/example/json',
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          'user-agent': registryUserAgent,
        },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('parses text responses through the same request path', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('v1.2.3\nv1.2.2\n'),
    })

    await expect(requestText('https://proxy.golang.org/example.com/module/@v/list')).resolves.toBe('v1.2.3\nv1.2.2\n')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          accept: 'text/plain',
          'user-agent': registryUserAgent,
        },
      }),
    )
  })

  it('reports non-2xx responses with their status code', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })

    const error = await requestJson('https://registry.example.test/package').catch(error => error)
    expect(error).toBeInstanceOf(RegistryRequestError)
    expect(error).toMatchObject({ kind: 'http', status: 503 })
  })

  it('reports invalid JSON separately from transport failures', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    })

    const error = await requestJson('https://registry.example.test/package').catch(error => error)
    expect(error).toMatchObject({ kind: 'invalid-response' })
  })

  it('reports network failures', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    const error = await requestJson('https://registry.example.test/package').catch(error => error)
    expect(error).toMatchObject({ kind: 'network' })
  })

  it('aborts requests that exceed the timeout', async () => {
    fetchMock.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))

    const error = await requestJson('https://registry.example.test/package', 1).catch(error => error)
    expect(error).toMatchObject({ kind: 'timeout' })
  })
})
