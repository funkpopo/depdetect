import fetch from 'npm-registry-fetch'
import { execCmd } from '../utils/cmd'

const NPM_REGISTRY = 'https://registry.npmjs.org/'

const mockPacoteVersion = '15.2.0'

function Header(name: string) {
  return {
    'user-agent': `pacote/${mockPacoteVersion} node/${process.version}`,
    'pacote-version': mockPacoteVersion,
    'pacote-req-type': 'packument',
    'pacote-pkg-id': `registry:${name}`,
    'accept': 'application/json',
  }
}

export async function version(name: string, cwd: string) {
  const registry = await getNpmRegistry(name, cwd)
  try {
    // Abbreviated (corgi) metadata still carries the per-version
    // `deprecated` flag while being far smaller than the full packument,
    // which keeps first-open latency low for packages with many releases.
    const data = await fetch.json(name, { registry, headers: Header(name) }) as { versions: { [version: string]: { deprecated: string } } }
    const versions = Object.keys(data.versions || {}).filter(v => (!v.includes('-') && !data.versions[v].deprecated))
    return versions
  }
  catch {
    return null
  }
}

const registryCache = new Map<string, Promise<string>>()
const defaultRegistryCache = new Map<string, Promise<string | undefined>>()
const scopedRegistryCache = new Map<string, Promise<string | undefined>>()

export async function getNpmRegistry(pkg: string, cwd: string) {
  const key = `${pkg}+++${cwd}`
  const cached = registryCache.get(key)
  if (cached)
    return cached

  const request = (async () => {
    const defaultRegistry = getDefaultRegistry(cwd)
    const scope = pkg.startsWith('@') ? pkg.split('/')[0] : undefined
    const scopedRegistry = scope ? getScopedRegistry(scope, cwd) : undefined
    const [defaultValue, scopedValue] = await Promise.all([
      defaultRegistry,
      scopedRegistry,
    ])
    return scopedValue || defaultValue || NPM_REGISTRY
  })()

  registryCache.set(key, request)
  return request
}

function getDefaultRegistry(cwd: string) {
  const cached = defaultRegistryCache.get(cwd)
  if (cached)
    return cached

  const request = execCmd('npm config get registry', cwd).catch(() => undefined)
  defaultRegistryCache.set(cwd, request)
  return request
}

function getScopedRegistry(scope: string, cwd: string) {
  const key = `${scope}+++${cwd}`
  const cached = scopedRegistryCache.get(key)
  if (cached)
    return cached

  const request = execCmd(`npm config get ${scope}:registry`, cwd).catch(() => undefined)
  scopedRegistryCache.set(key, request)
  return request
}
