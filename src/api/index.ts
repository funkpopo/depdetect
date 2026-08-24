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

export interface PackageData {
  version: string[]
  info?: string
}

export async function getPackageData(
  item: Item,
  root: string,
  forceFresh = false,
): Promise<PackageData> {
  const preTest = protocolDep(item)
  if (preTest)
    return preTest

  const name = item.key
  const cacheKey = `${item.registry}:${name}`

  const cached = getCacheData(cacheKey)
  const cacheData = cached ? normalizeVersions(item, cached) : undefined
  if (cacheData && !forceFresh) {
    if (cached && (cached.length !== cacheData.length || cached.some((version, index) => version !== cacheData[index]))) {
      setCacheData(cacheKey, cacheData)
    }
    console.log('vscode-packages: use cache', name)
    return { version: cacheData }
  }

  const version = await reGetVersion(item, root)
  console.log('vscode-packages: fetch', name)

  return {
    version: version ?? cacheData ?? [],
  }
}

async function reGetVersion(item: Item, root: string): Promise<string[] | undefined> {
  const key = `${root}+++${item.registry}+++${item.key}`
  const pending = pendingVersions.get(key)
  if (pending)
    return pending

  const request = (async () => {
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
  })().finally(() => {
    if (pendingVersions.get(key) === request)
      pendingVersions.delete(key)
  })

  pendingVersions.set(key, request)
  return request
}

export function saveCache() {
  dumpCache(cache, cacheChanged)
}

function getCacheData(key: string): string[] | undefined {
  const entry = cache.get(key)
  if (!entry)
    return undefined

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    cacheChanged = true
    return undefined
  }

  return entry.data
}

function setCacheData(key: string, data: string[]) {
  const entry: CacheEntry = {
    data,
    expiresAt: Date.now() + cacheTtl,
  }
  cache.set(key, entry)
  cacheChanged = true
}
