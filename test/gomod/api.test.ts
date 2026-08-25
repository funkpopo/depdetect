import { beforeEach, describe, expect, it, vi } from 'vitest'
import { escapeGoModulePath } from '../../src/api/gomod'

const mocks = vi.hoisted(() => ({ requestText: vi.fn() }))

vi.mock('../../src/api/request', () => ({ requestText: mocks.requestText }))

describe('go module proxy API', () => {
  beforeEach(() => mocks.requestText.mockReset())

  it('escapes uppercase letters and exclamation marks per the proxy protocol', () => {
    expect(escapeGoModulePath('github.com/Azure/go-ntlmssp')).toBe('github.com/!azure/go-ntlmssp')
    expect(escapeGoModulePath('example.com/Hello!World')).toBe('example.com/!hello!!!world')
  })

  it('returns versions from the plain-text proxy response', async () => {
    mocks.requestText.mockResolvedValue('v1.2.3\n v1.2.2\n')

    const { goModuleVersions } = await import('../../src/api/gomod')
    await expect(goModuleVersions('github.com/Azure/go-ntlmssp')).resolves.toEqual(['v1.2.3', 'v1.2.2'])
    expect(mocks.requestText).toHaveBeenCalledWith('https://proxy.golang.org/github.com/!azure/go-ntlmssp/@v/list')
  })
})
