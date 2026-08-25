import { requestJson } from './request'

interface PyPiResponse {
  releases?: Record<string, Array<{ yanked?: boolean }>>
}

export async function pypiVersions(name: string): Promise<string[] | null> {
  try {
    const data = await requestJson<PyPiResponse>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)
    return Object.entries(data.releases ?? {})
      .filter(([, files]) => files.some(file => !file.yanked))
      .map(([version]) => version)
  }
  catch {
    return null
  }
}
