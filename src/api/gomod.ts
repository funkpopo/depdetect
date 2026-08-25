import { requestText } from './request'

/** Escape a module path according to the Go module proxy protocol. */
export function escapeGoModulePath(modulePath: string) {
  let escaped = ''
  for (const character of modulePath) {
    if (character === '!')
      escaped += '!!'
    else if (character >= 'A' && character <= 'Z')
      escaped += `!${character.toLowerCase()}`
    else
      escaped += character
  }
  return escaped.split('/').map(encodeURIComponent).join('/')
}

export async function goModuleVersions(modulePath: string): Promise<string[] | null> {
  try {
    const escapedPath = escapeGoModulePath(modulePath)
    const response = await requestText(`https://proxy.golang.org/${escapedPath}/@v/list`)
    return response.split(/\r?\n/).map(version => version.trim()).filter(Boolean)
  }
  catch {
    return null
  }
}
