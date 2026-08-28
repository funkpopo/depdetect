import { CompletionItem, CompletionItemKind, CompletionList } from 'vscode'
import { sortText } from '../providers/autoCompletion'
import { statusBarItem } from '../ui/indicators'
import { getPackageData, type PackageData } from '../api'
import type Dependency from './Dependency'
import type Item from './Item'
import { normalizeVersions, retainRelevantVersions } from './versions'

/** Invoked with the full response snapshot every time a dependency settles. */
export type FetchUpdateListener = (
  dependencies: Dependency[],
  settled: number,
  total: number,
) => void

function buildDependency(item: Item, data: PackageData): Dependency {
  const versions = retainRelevantVersions(item, normalizeVersions(item, data.version))
  let i = 0
  const versionCompletionItems = new CompletionList(
    versions.map(version => {
      const completionItem = new CompletionItem(
        version,
        CompletionItemKind.Class,
      )
      completionItem.preselect = i === 0
      completionItem.sortText = sortText(i++)
      return completionItem
    }),
    true,
  )
  return {
    item,
    versions,
    info: data.info,
    versionCompletionItems,
  }
}

export async function fetchPackageVersions(
  dependencies: Item[],
  root: string,
  forceFresh = false,
  onUpdate?: FetchUpdateListener,
): Promise<[Dependency[], Map<string, Dependency[]>]> {
  statusBarItem.setText('👀 Fetching registry')

  const responsesMap: Map<string, Dependency[]> = new Map()
  // Placeholders keep responses aligned with the requested items while
  // individual registry requests are still in flight.
  const responses: Dependency[] = dependencies.map(item => ({ item }))
  const total = dependencies.length
  let settled = 0

  const notify = () => onUpdate?.([...responses], settled, total)

  if (total === 0)
    return [responses, responsesMap]

  const tasks = dependencies.map((item, index) => (async () => {
    try {
      const data = await getPackageData(item, root, forceFresh)
      const dependency = buildDependency(item, data)
      responses[index] = dependency
      const found = responsesMap.get(item.key)
      if (found)
        found.push(dependency)

      else
        responsesMap.set(item.key, [dependency])

      // A stale cache entry was served immediately. Publish the fresher
      // registry data as soon as the background revalidation completes so
      // decorations do not stay outdated until the next reload.
      void data.refreshed
        ?.then(update => {
          if (!update)
            return
          responses[index] = buildDependency(item, update)
          notify()
        })
        .catch(() => undefined)
    }
    catch (error) {
      console.error(error)
      responses[index] = {
        item,
        error: `${item.key}: ${error}`,
      }
    }
    finally {
      settled++
      notify()
    }
  })())

  await Promise.all(tasks)

  return [responses, responsesMap]
}
