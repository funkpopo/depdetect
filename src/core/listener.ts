import type { ExtensionContext, Position, TextDocument, TextEditor } from 'vscode'
import { Range, window, workspace } from 'vscode'

import decorate, { clearDocumentDecorations } from '../ui/decorator'
import { parseJson } from '../json/parse'
import { parseRequirements } from '../requirements/parse'
import { parsePyProject } from '../pyproject/parse'
import { parseGoMod } from '../gomod/parse'
import { parsePom } from '../maven/parse'
import { statusBarItem } from '../ui/indicators'
import type Dependency from './Dependency'
import type Item from './Item'
import { fetchPackageVersions } from './fetcher'
import { getRoot } from '../utils/resolve'
import {
  documentKey,
  documentSessions,
  ensureDocumentSession,
  getDocumentSession,
  removeDocumentSession,
} from './DocumentSession'

function parseDeps(document: TextDocument): Item[] {
  if (isRequirements(document))
    return parseRequirements(document.getText())
  if (isPyProject(document))
    return parsePyProject(document.getText())
  if (isGoMod(document))
    return parseGoMod(document.getText())
  if (isPom(document))
    return parsePom(document.getText())
  return parseJson(document.getText())
}

export interface ListenerOptions {
  /** Fetch package metadata when this editor is first loaded. */
  fetch?: boolean
  /** Fetch only dependencies that have not been fetched successfully yet. */
  incremental?: boolean
  /** Ignore the document state and fetch fresh package metadata. */
  forceFresh?: boolean
}

interface PendingDocumentFetch {
  identity: string
  promise: Promise<Dependency[]>
}

const pendingDocumentFetches = new Map<string, PendingDocumentFetch>()

function dependencyIdentity(items: Item[]) {
  return items
    .map(item => `${item.registry}:${item.key}`)
    .sort()
    .join('\n')
}

function dependencyKey(item: Pick<Item, 'registry' | 'key'>) {
  return `${item.registry}:${item.key}`
}

function dependencySlot(item: Pick<Item, 'registry' | 'key' | 'start' | 'end'>) {
  return `${dependencyKey(item)}:${item.start}:${item.end}`
}

function rebindDependencies(items: Item[], fetched: Dependency[]) {
  const fetchedByKey = new Map<string, Dependency[]>()
  for (const dependency of fetched) {
    const sameKey = fetchedByKey.get(dependencyKey(dependency.item))
    if (sameKey)
      sameKey.push(dependency)
    else
      fetchedByKey.set(dependencyKey(dependency.item), [dependency])
  }

  const occurrences = new Map<string, number>()
  return items.map(item => {
    const key = dependencyKey(item)
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)

    const previous = fetchedByKey.get(key)?.[occurrence]
    return previous ? { ...previous, item } : { item }
  })
}

function getFetchedMap(fetched: Dependency[]) {
  const result = new Map<string, Dependency[]>()
  for (const dependency of fetched) {
    const sameKey = result.get(dependency.item.key)
    if (sameKey)
      sameKey.push(dependency)
    else
      result.set(dependency.item.key, [dependency])
  }
  return result
}

function dependenciesNeedingFetch(items: Item[], fetched: Dependency[]) {
  const currentFetched = rebindDependencies(items, fetched)
  return items.filter((_, index) => {
    const dependency = currentFetched[index]
    // An empty versions array is a valid response meaning that the package
    // has no stable versions. Only an absent result or an error should be
    // retried during the next save.
    return dependency.versions === undefined || dependency.error !== undefined
  })
}

function mergeFetchedDependencies(
  items: Item[],
  previous: Dependency[],
  updates: Dependency[],
) {
  const previousBySlot = new Map<string, Dependency>()
  const updatesBySlot = new Map<string, Dependency>()

  for (const dependency of rebindDependencies(items, previous)) {
    previousBySlot.set(dependencySlot(dependency.item), dependency)
  }
  for (const dependency of updates) {
    updatesBySlot.set(dependencySlot(dependency.item), dependency)
  }

  return items.map(item => {
    return updatesBySlot.get(dependencySlot(item))
      ?? previousBySlot.get(dependencySlot(item))
      ?? { item }
  })
}

function fetchDocumentState(
  editor: TextEditor,
  items: Item[],
  root: string,
  forceFresh: boolean,
): Promise<Dependency[]> {
  const key = documentKey(editor.document)
  const session = ensureDocumentSession(editor.document)
  const identity = dependencyIdentity(items)
  const pending = pendingDocumentFetches.get(key)
  if (pending) {
    if (pending.identity === identity && !forceFresh)
      return pending.promise

    // A package name may be edited while the previous registry request is
    // still running. Queue the new identity after it instead of reusing stale
    // metadata for the newly named dependency.
    return pending.promise.then(() => {
      if (documentSessions.get(key) !== session)
        return []
      return fetchDocumentState(editor, items, root, forceFresh)
    })
  }

  const request: Promise<Dependency[]> = fetchPackageVersions(items, root, forceFresh)
    .then(([fetched]) => fetched)
    .finally(() => {
      if (pendingDocumentFetches.get(key)?.promise === request)
        pendingDocumentFetches.delete(key)
    })

  pendingDocumentFetches.set(key, { identity, promise: request })
  return request
}

function hasDocumentState(editor: TextEditor) {
  const key = documentKey(editor.document)
  return documentSessions.has(key) || pendingDocumentFetches.has(key)
}

export function getFetchedDependency(document: TextDocument, dep: string, position: Position): Dependency | undefined {
  const fetchedDep = getDocumentSession(document)?.fetchedDepsMap.get(dep)
  if (!fetchedDep)
    return
  if (fetchedDep.length === 1) {
    return fetchedDep[0]
  }
  else {
    for (let i = 0; i < fetchedDep.length; i++) {
      const range = new Range(
        document.positionAt(fetchedDep[i].item.start + 1),
        document.positionAt(fetchedDep[i].item.end),
      )
      if (range.contains(position))
        return fetchedDep[i]
    }
  }
}

export async function parseAndDecorate(
  editor: TextEditor,
  _wasSaved = false,
  fetchDeps = true,
  forceFresh = false,
  root = getRoot(editor.document),
  fetchItems?: Item[],
) {
  // const config = workspace.getConfiguration('', editor.document.uri)

  try {
    const parsedDependencies = parseDeps(editor.document)
    const key = documentKey(editor.document)
    const session = ensureDocumentSession(editor.document)
    const generation = ++session.generation
    session.inProgress = true
    let fetched: Dependency[] | undefined

    if (fetchDeps) {
      fetched = await fetchDocumentState(
        editor,
        fetchItems ?? parsedDependencies,
        root,
        forceFresh,
      )
    }
    else {
      fetched = session.fetchedDeps
      if (fetched.length === 0) {
        const pending = pendingDocumentFetches.get(key)
        if (pending)
          fetched = await pending.promise
      }
    }

    if (documentSessions.get(key) !== session || session.generation !== generation)
      return

    // The document may have changed while package metadata was being
    // fetched. Re-read it so offsets and the visible decorations belong to
    // the current document version.
    const currentDependencies = parseDeps(editor.document)
    const currentFetched = fetchItems
      ? mergeFetchedDependencies(currentDependencies, session.fetchedDeps, fetched ?? [])
      : rebindDependencies(currentDependencies, fetched ?? [])
    session.dependencies = currentDependencies
    session.fetchedDeps = currentFetched
    session.fetchedDepsMap = getFetchedMap(currentFetched)
    session.documentVersion = editor.document.version
    session.summary = {
      total: currentFetched.length,
      fetched: currentFetched.filter(dep => dep.versions?.length).length,
      failed: currentFetched.filter(dep => dep.error).length,
    }
    decorate(editor, currentFetched)
  }
  catch (e) {
    console.error(e)
    statusBarItem.setText('Dependency file is not valid!')
    clearDocumentDecorations(editor)
  }
  finally {
    const session = getDocumentSession(editor.document)
    if (session)
      session.inProgress = false
  }
}

function isPackageJson(document: TextDocument) {
  return document.fileName.toLocaleLowerCase().endsWith('package.json')
}

function isRequirements(document: TextDocument) {
  return document.fileName.toLocaleLowerCase().endsWith('requirements.txt')
}

function isPyProject(document: TextDocument) {
  return document.fileName.toLocaleLowerCase().endsWith('pyproject.toml')
}

function isGoMod(document: TextDocument) {
  return document.fileName.toLocaleLowerCase().endsWith('go.mod')
}

function isPom(document: TextDocument) {
  return /(?:^|[\\/])pom\.xml$/i.test(document.fileName)
}

function isDependencyFile(document: TextDocument) {
  return isPackageJson(document) || isRequirements(document) || isPyProject(document) || isGoMod(document) || isPom(document)
}

function editorForDocument(document: TextDocument) {
  const sameDocument = (editor: TextEditor) => editor.document.uri.toString() === document.uri.toString()
  const activeEditor = window.activeTextEditor
  if (activeEditor && sameDocument(activeEditor))
    return activeEditor

  const visibleEditors = (window as typeof window & { visibleTextEditors?: readonly TextEditor[] }).visibleTextEditors
  return visibleEditors?.find(sameDocument)
}

function isDiffEditor(editor: TextEditor | undefined) {
  if (!editor)
    return false

  // Git-based diff sides can have a non-file URI. The modified side can
  // still use the normal file URI, so also inspect the active tab input when
  // that VS Code API is available.
  if (['git', 'gitlens', 'scm', 'vscode-scm'].includes(editor.document.uri.scheme))
    return true

  const tabGroups = (window as typeof window & {
    tabGroups?: {
      activeTabGroup?: {
        activeTab?: { input?: unknown }
      }
    }
  }).tabGroups
  const input = tabGroups?.activeTabGroup?.activeTab?.input
  return typeof input === 'object'
    && input !== null
    && 'original' in input
    && 'modified' in input
}

export default async function listener(
  editor: TextEditor | undefined,
  options: ListenerOptions = {},
) {
  if (editor) {
    if (isDependencyFile(editor.document)) {
      statusBarItem.show()

      // Version-only edits reuse fetched metadata. Adding, removing, or
      // renaming a dependency is handled on save in incremental mode.
      const hadDocumentState = hasDocumentState(editor)
      const session = ensureDocumentSession(editor.document)
      const parsedDependencies = parseDeps(editor.document)
      const incrementalItems = options.incremental && !options.forceFresh
        ? dependenciesNeedingFetch(parsedDependencies, session.fetchedDeps)
        : undefined
      const shouldFetch = options.forceFresh === true
        || (options.incremental === true
          ? options.fetch !== false && (incrementalItems?.length ?? 0) > 0
          : options.fetch !== false && !hadDocumentState)
      // Resolve this before starting asynchronous registry work. The active
      // editor may change while the request is in flight.
      const root = getRoot(editor.document)

      session.inProgress = true
      await parseAndDecorate(
        editor,
        false,
        shouldFetch,
        options.forceFresh === true,
        root,
        options.forceFresh === true ? undefined : incrementalItems,
      )
    }
    else {
      statusBarItem.hide()
    }
  }
  else {
    console.log('No active edtior found.')
  }

  return Promise.resolve()
}

let throttleId: NodeJS.Timeout | undefined

export function throttledListener(
  editor: TextEditor | undefined,
  timeout = 0,
  options: ListenerOptions = {},
) {
  if (throttleId)
    clearTimeout(throttleId)
  throttleId = setTimeout(() => {
    void listener(editor, options)
    throttleId = undefined
  }, timeout)
}

export function registerListener(context: ExtensionContext) {
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(editor => {
      void listener(editor, isDiffEditor(editor) ? { fetch: false } : {})
    }),
    workspace.onDidChangeTextDocument(e => {
      const editor = editorForDocument(e.document)
      if (editor && isDependencyFile(e.document))
        throttledListener(editor, 100, { fetch: false })
    }),
    workspace.onDidSaveTextDocument(document => {
      const editor = editorForDocument(document)
      if (editor && isDependencyFile(document))
        throttledListener(editor, 100, { incremental: true })
    }),
    workspace.onDidCloseTextDocument(document => {
      removeDocumentSession(document)
    }),
    // When activation is triggered while VS Code is restoring the workbench,
    // activeTextEditor can briefly be undefined and no active-editor event is
    // guaranteed afterwards. Visible editors provide a second, reliable
    // activation path for an already-open package.json.
    window.onDidChangeVisibleTextEditors(editors => {
      for (const editor of editors) {
        if (isDependencyFile(editor.document))
          void listener(editor, isDiffEditor(editor) ? { fetch: false } : {})
      }
    }),
  )

  const activeEditor = window.activeTextEditor
  void listener(activeEditor, isDiffEditor(activeEditor) ? { fetch: false } : {})

  // Defer one more check until the workbench has finished restoring editors.
  // This covers the extension being activated before package.json becomes the
  // active editor at startup.
  const startupRefresh = setTimeout(() => {
    const editor = window.activeTextEditor
    void listener(editor, isDiffEditor(editor) ? { fetch: false } : {})
  }, 0)
  context.subscriptions.push({ dispose: () => clearTimeout(startupRefresh) })
}
