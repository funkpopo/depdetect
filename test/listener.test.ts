import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Item from '../src/core/Item'
import listener, { registerListener } from '../src/core/listener'
import { documentSessions, getDocumentSession } from '../src/core/DocumentSession'

const mocks = vi.hoisted(() => ({
  fetchPackageVersions: vi.fn(),
  decorate: vi.fn(),
  statusBarItem: {
    show: vi.fn(),
    hide: vi.fn(),
    setText: vi.fn(),
  },
  workspaceFolder: vi.fn(),
  closeDocument: undefined as undefined | ((document: unknown) => void),
}))

vi.mock('vscode', () => ({
  Range: class {},
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getWorkspaceFolder: mocks.workspaceFolder,
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn((handler: (document: unknown) => void) => {
      mocks.closeDocument = handler
      return { dispose: vi.fn() }
    }),
  },
}))

vi.mock('../src/core/fetcher', () => ({
  fetchPackageVersions: mocks.fetchPackageVersions,
}))

vi.mock('../src/ui/decorator', () => ({
  default: mocks.decorate,
  clearDocumentDecorations: vi.fn(),
}))

vi.mock('../src/ui/indicators', () => ({
  statusBarItem: mocks.statusBarItem,
}))

mocks.fetchPackageVersions.mockImplementation(async (items: Item[]) => {
  const fetched = items.map(item => ({
    item,
    versions: ['2.0.0'],
  }))
  return [fetched, new Map()]
})

describe('package document listener', () => {
  beforeEach(() => {
    documentSessions.clear()
    mocks.fetchPackageVersions.mockClear()
    mocks.decorate.mockClear()
    mocks.workspaceFolder.mockReset()
    mocks.workspaceFolder.mockReturnValue({ uri: { fsPath: 'C:\\workspace' } })
  })

  it('does not fetch again when only the version changes or the document reopens', async () => {
    let text = `{
  "dependencies": {
    "example": "1.0.0"
  }
}`
    const document = {
      uri: { toString: () => 'file:///workspace/package.json' },
      fileName: 'package.json',
      getText: () => text,
    }
    const editor = { document } as never

    await listener(editor)
    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(1)

    text = text.replace('1.0.0', '1.1.0')
    await listener(editor, { fetch: false })
    await listener(editor)
    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(1)

    await listener(editor, { forceFresh: true })
    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(2)
  })

  it('fetches only a newly added dependency when the document is saved', async () => {
    let text = `{ "dependencies": { "vsce": "^2.15.0" } }`
    const document = {
      uri: { toString: () => 'file:///workspace/package.json' },
      fileName: 'package.json',
      getText: () => text,
    }
    const editor = { document } as never

    await listener(editor)
    text = `{ "dependencies": { "@vscode/vsce": "^2.15.0" } }`
    await listener(editor, { fetch: false })
    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(1)

    await listener(editor, { incremental: true })

    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(2)
    expect((mocks.fetchPackageVersions.mock.lastCall?.[0] as Item[])[0].key).toBe('@vscode/vsce')
    expect(getDocumentSession(document as never)?.fetchedDeps[0]).toMatchObject({
      item: { key: '@vscode/vsce' },
      versions: ['2.0.0'],
    })
  })

  it('queues a newly added dependency saved while the initial fetch is running', async () => {
    let resolveInitial: ((value: unknown) => void) | undefined
    mocks.fetchPackageVersions.mockImplementationOnce(() => new Promise(resolve => {
      resolveInitial = resolve
    }))

    let text = `{ "dependencies": { "vsce": "^2.15.0" } }`
    const document = {
      uri: { toString: () => 'file:///workspace/package.json' },
      fileName: 'package.json',
      getText: () => text,
    }
    const editor = { document } as never

    const initialRequest = listener(editor)
    text = `{ "dependencies": { "@vscode/vsce": "^2.15.0" } }`
    const changedRequest = listener(editor, { fetch: false })
    const savedRequest = listener(editor, { incremental: true })
    resolveInitial?.([[{ item: mocks.fetchPackageVersions.mock.calls[0][0][0], versions: ['2.15.0'] }], new Map()])

    await Promise.all([initialRequest, changedRequest, savedRequest])

    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(2)
    expect((mocks.fetchPackageVersions.mock.lastCall?.[0] as Item[])[0].key).toBe('@vscode/vsce')
    expect(getDocumentSession(document as never)?.fetchedDeps[0].item.key).toBe('@vscode/vsce')
  })

  it('does not refetch existing dependencies or removed dependencies on save', async () => {
    let text = `{ "dependencies": { "keep": "1.0.0", "remove": "1.0.0" } }`
    const document = {
      uri: { toString: () => 'file:///workspace/package.json' },
      fileName: 'package.json',
      getText: () => text,
    }
    const editor = { document } as never

    await listener(editor)
    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(1)
    expect(mocks.fetchPackageVersions.mock.calls[0][0]).toHaveLength(2)

    text = `{ "dependencies": { "keep": "2.0.0" } }`
    await listener(editor, { fetch: false })
    await listener(editor, { incremental: true })

    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(1)
    expect(getDocumentSession(document as never)?.fetchedDeps.map(dep => dep.item.key)).toEqual(['keep'])
  })

  it('retries a failed dependency on save without refetching successful ones', async () => {
    mocks.fetchPackageVersions.mockImplementationOnce(async (items: Item[]) => [
      items.map(item => item.key === 'failed'
        ? { item, error: 'failed: offline' }
        : { item, versions: ['2.0.0'] }),
      new Map(),
    ])

    const document = {
      uri: { toString: () => 'file:///workspace/package.json' },
      fileName: 'package.json',
      getText: () => `{ "dependencies": { "working": "1.0.0", "failed": "1.0.0" } }`,
    }
    const editor = { document } as never

    await listener(editor)
    await listener(editor, { incremental: true })

    expect(mocks.fetchPackageVersions).toHaveBeenCalledTimes(2)
    expect((mocks.fetchPackageVersions.mock.calls[1][0] as Item[]).map(item => item.key)).toEqual(['failed'])
    expect(getDocumentSession(document as never)?.fetchedDeps).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: expect.objectContaining({ key: 'working' }), versions: ['2.0.0'] }),
      expect.objectContaining({ item: expect.objectContaining({ key: 'failed' }), versions: ['2.0.0'] }),
    ]))
  })

  it('recognizes go.mod documents and fetches Go module versions', async () => {
    const document = {
      uri: { toString: () => 'file:///workspace/go.mod' },
      fileName: 'go.mod',
      getText: () => `module example.com/project

require github.com/stretchr/testify v1.10.0
`,
    }

    await listener({ document } as never)

    const items = mocks.fetchPackageVersions.mock.lastCall?.[0] as Item[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      key: 'github.com/stretchr/testify',
      value: 'v1.10.0',
      registry: 'go',
      plainVersion: true,
    })
  })

  it('recognizes pom.xml documents and fetches Maven artifact versions', async () => {
    const document = {
      uri: { toString: () => 'file:///workspace/pom.xml' },
      fileName: 'C:\\workspace\\pom.xml',
      getText: () => `<project><dependencies><dependency>
        <groupId>org.apache.pdfbox</groupId>
        <artifactId>pdfbox</artifactId>
        <version>2.0.34</version>
      </dependency></dependencies></project>`,
    }

    await listener({ document } as never)

    const items = mocks.fetchPackageVersions.mock.lastCall?.[0] as Item[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      key: 'org.apache.pdfbox:pdfbox',
      value: '2.0.34',
      registry: 'maven',
      plainVersion: true,
    })
  })

  it('keeps results isolated when two documents finish in reverse order', async () => {
    const resolvers = new Map<string, (value: unknown) => void>()
    mocks.fetchPackageVersions.mockImplementationOnce((items: Item[]) => new Promise(resolve => {
      resolvers.set(items[0].key, resolve)
    })).mockImplementationOnce((items: Item[]) => new Promise(resolve => {
      resolvers.set(items[0].key, resolve)
    }))

    const makeEditor = (uri: string, name: string) => ({
      document: {
        uri: { toString: () => uri },
        fileName: 'package.json',
        getText: () => `{ "dependencies": { "${name}": "1.0.0" } }`,
      },
    }) as never
    const editorA = makeEditor('file:///workspace/a/package.json', 'package-a')
    const editorB = makeEditor('file:///workspace/b/package.json', 'package-b')

    const requestA = listener(editorA)
    const requestB = listener(editorB)
    resolvers.get('package-b')?.([[{ item: (editorB as any).document && mocks.fetchPackageVersions.mock.calls[1][0][0], versions: ['2.0.0'] }], new Map()])
    await requestB
    resolvers.get('package-a')?.([[{ item: mocks.fetchPackageVersions.mock.calls[0][0][0], versions: ['3.0.0'] }], new Map()])
    await requestA

    expect(getDocumentSession((editorA as any).document)?.fetchedDeps[0].item.key).toBe('package-a')
    expect(getDocumentSession((editorB as any).document)?.fetchedDeps[0].item.key).toBe('package-b')
    expect(mocks.decorate).toHaveBeenCalledTimes(2)
  })

  it('only forces the document that explicitly requests a retry', async () => {
    const makeEditor = (uri: string, name: string) => ({
      document: {
        uri: { toString: () => uri },
        fileName: 'package.json',
        getText: () => `{ "dependencies": { "${name}": "1.0.0" } }`,
      },
    }) as never

    await Promise.all([
      listener(makeEditor('file:///workspace/a/package.json', 'package-a'), { forceFresh: true }),
      listener(makeEditor('file:///workspace/b/package.json', 'package-b')),
    ])

    const calls = mocks.fetchPackageVersions.mock.calls.map(([items, root, forceFresh]) => ({
      name: (items as Item[])[0].key,
      root,
      forceFresh,
    }))
    expect(calls).toContainEqual({ name: 'package-a', root: 'C:\\workspace', forceFresh: true })
    expect(calls).toContainEqual({ name: 'package-b', root: 'C:\\workspace', forceFresh: false })
  })

  it('removes a closed document session and ignores its late result', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined
    mocks.fetchPackageVersions.mockImplementationOnce(() => new Promise(resolve => {
      resolveFetch = resolve
    }))
    const document = {
      uri: { toString: () => 'file:///workspace/closing/package.json' },
      fileName: 'package.json',
      getText: () => `{ "dependencies": { "closing": "1.0.0" } }`,
    }
    const editor = { document } as never
    const context = { subscriptions: { push: vi.fn() } } as never

    registerListener(context)
    const request = listener(editor)
    expect(documentSessions.has(document.uri.toString())).toBe(true)
    mocks.closeDocument?.(document)
    resolveFetch?.([[{ item: mocks.fetchPackageVersions.mock.lastCall?.[0][0], versions: ['2.0.0'] }], new Map()])
    await request

    expect(documentSessions.has(document.uri.toString())).toBe(false)
    expect(mocks.decorate).not.toHaveBeenCalled()
  })

  it('passes each target document workspace root to its own request', async () => {
    mocks.workspaceFolder.mockImplementation((uri: { toString: () => string }) => {
      const value = uri.toString()
      if (value.includes('/alpha/'))
        return { uri: { fsPath: 'C:\\projects\\alpha' } }
      if (value.includes('/beta/'))
        return { uri: { fsPath: 'C:\\projects\\beta' } }
      return undefined
    })

    const makeEditor = (project: string, name: string) => ({
      document: {
        uri: {
          fsPath: `C:\\projects\\${project}\\package.json`,
          toString: () => `file:///projects/${project}/package.json`,
        },
        fileName: `C:\\projects\\${project}\\package.json`,
        getText: () => `{ "dependencies": { "${name}": "1.0.0" } }`,
      },
    }) as never

    await listener(makeEditor('alpha', 'alpha-package'))
    await listener(makeEditor('beta', 'beta-package'))

    expect(mocks.fetchPackageVersions.mock.calls.map(([, root]) => root)).toEqual([
      'C:\\projects\\alpha',
      'C:\\projects\\beta',
    ])
  })

  it('falls back to the dependency document directory without a workspace', async () => {
    mocks.workspaceFolder.mockReturnValue(undefined)
    const document = {
      uri: {
        fsPath: 'C:\\standalone\\package.json',
        toString: () => 'file:///standalone/package.json',
      },
      fileName: 'C:\\standalone\\package.json',
      getText: () => `{ "dependencies": { "standalone-package": "1.0.0" } }`,
    }

    await listener({ document } as never)

    expect(mocks.fetchPackageVersions.mock.lastCall?.[1]).toBe('C:\\standalone')
  })
})
