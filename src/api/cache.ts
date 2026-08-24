import { resolve } from 'node:path'
import os from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export interface CacheEntry {
  data: string[]
  expiresAt: number
}

export type VersionCache = Map<string, CacheEntry>

export const cacheTtl = 10 * 60_000

const cacheDir = resolve(os.tmpdir(), 'depdetect')
const cachePath = resolve(cacheDir, 'cache.json')

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object')
    return false

  const entry = value as Partial<CacheEntry>
  return Number.isFinite(entry.expiresAt)
    && Array.isArray(entry.data)
    && entry.data.every(version => typeof version === 'string')
}

export function loadCache(): VersionCache {
  const cache: VersionCache = new Map()
  if (!existsSync(cachePath))
    return cache

  try {
    const persisted: unknown = JSON.parse(readFileSync(cachePath, 'utf-8'))
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted))
      return cache

    const now = Date.now()
    for (const [key, value] of Object.entries(persisted)) {
      if (isCacheEntry(value) && value.expiresAt > now)
        cache.set(key, value)
    }
  }
  catch (error) {
    console.error('Failed to load cache')
    console.error(error)
  }
  return cache
}

export function dumpCache(cache: ReadonlyMap<string, CacheEntry>, cacheChanged: boolean) {
  if (!cacheChanged)
    return

  try {
    const persisted: Record<string, CacheEntry> = {}
    for (const [key, entry] of cache)
      persisted[key] = entry

    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cachePath, JSON.stringify(persisted), 'utf-8')
    console.log(`cache saved to ${cachePath}`)
  }
  catch (error) {
    console.warn('Failed to save cache')
    console.warn(error)
  }
}
