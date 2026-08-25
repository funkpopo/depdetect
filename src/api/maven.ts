import { requestJson } from './request'

interface MavenSearchResponse {
  response?: {
    docs?: Array<{ v?: string }>
  }
}

/** Fetch published versions for a groupId:artifactId coordinate from Maven Central. */
export async function mavenVersions(coordinate: string): Promise<string[] | null> {
  const separator = coordinate.indexOf(':')
  if (separator <= 0 || separator === coordinate.length - 1)
    return null

  const groupId = coordinate.slice(0, separator)
  const artifactId = coordinate.slice(separator + 1)
  if (!/^[\w.-]+$/.test(groupId) || !/^[\w.-]+$/.test(artifactId))
    return null
  const query = `g:"${groupId}" AND a:"${artifactId}"`

  try {
    const url = new URL('https://search.maven.org/solrsearch/select')
    url.search = new URLSearchParams({
      q: query,
      core: 'gav',
      rows: '200',
      wt: 'json',
    }).toString()
    const data = await requestJson<MavenSearchResponse>(url.toString())
    return (data.response?.docs ?? [])
      .map(document => document.v)
      .filter((version): version is string => Boolean(version))
  }
  catch {
    return null
  }
}
