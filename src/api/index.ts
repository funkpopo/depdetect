import pLimit from 'p-limit'
import type Item from '../core/Item'
import { cacheTtl, dumpCache, loadCache, type CacheEntry } from './cache'
import { version } from './version'
import { pypiVersions } from './pypi'
import { goModuleVersions } from './gomod'
import { mavenVersions } from './maven'
import { protocolDep } from './utils'
import { normalizeVersions } from '../core/versions'

const cache = loadCache()

let cacheChanged = false
const pendingVersions = new Map<string, Promise<string[] | undefined>>()
/**
 * Bound concurrent registry traffic. Both direct lookups and background
 * revalidations of stale cache entries go through this limiter so opening a
 * large dependency file cannot flood the network.
 */
const requestLimit = pLimit(10)

export interface PackageData {
  version: string[]
  info?: string
  /**
   * Resolves when a background revalidation of a stale cache entry has
   * finished. The stale data is rendered immediately; callers can use this
   * promise to re-render once fresher registry data becomes available.
   */
  refreshed?: Promise<PackageData | undefined>
}

export async function getPackageData(
  item: Item,
  root: string,
  forceFresh = false,
): Promise<PackageData> {
  const preTest = protocolDep(item)
  if (preTest)
    return preTest

  const cacheKey = `${item.registry}:${item.key}`
  const entry = cache.get(cacheKey)
  if (entry && !forceFresh) {
    const cacheData = normalizeVersions(item, entry.data)
    if (entry.expiresAt > Date.now()) {
      console.log('vscode-packages: use cache', item.key)
      return { version: cacheData }
    }

    // Stale-while-revalidate: serve the expired entry right away so the
    // file never blocks on the network, and refresh it in the background.
    console.log('vscode-packages: stale cache, revalidating', item.key)
    const refreshed = reGetVersion(item, root)
      .then(versions => (versions ? { version: versions } : undefined))
    return { version: cacheData, refreshed }
  }

  const versions = await reGetVersion(item, root)
  console.log('vscode-packages: fetch', item.key)

  return {
    version: versions ?? [],
  }
}

async function reGetVersion(item: Item, root: string): Promise<string[] | undefined> {
  const key = `${root}+++${item.registry}+++${item.key}`
  const pending = pendingVersions.get(key)
  if (pending)
    return pending

  const request = requestLimit(async () => {
    try {
      const data = item.registry === 'pypi'
        ? await pypiVersions(item.key)
        : item.registry === 'go'
          ? await goModuleVersions(item.key)
          : item.registry === 'maven'
            ? await mavenVersions(item.key)
            : await version(item.key, root)

      if (data) {
        const versions = normalizeVersions(item, data)
        setCacheData(`${item.registry}:${item.key}`, versions)
        return versions
      }
    }
    catch (e) {
      console.error(e)
    }

    return undefined
  }).finally(() => {
    if (pendingVersions.get(key) === request)
      pendingVersions.delete(key)
  })

  pendingVersions.set(key, request)
  return request
}

export function saveCache() {
  dumpCache(cache, cacheChanged)
}

function setCacheData(key: string, data: string[]) {
  const entry: CacheEntry = {
    data,
    expiresAt: Date.now() + cacheTtl,
  }
  cache.set(key, entry)
  cacheChanged = true
}
