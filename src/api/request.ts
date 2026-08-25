export const registryRequestTimeout = 10_000
export const registryUserAgent = 'DepDetect/0.1.2'

export type RegistryRequestErrorKind = 'http' | 'invalid-response' | 'timeout' | 'network'

export class RegistryRequestError extends Error {
  readonly kind: RegistryRequestErrorKind
  readonly status?: number

  constructor(
    kind: RegistryRequestErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'RegistryRequestError'
    this.kind = kind
    this.status = options.status
    this.cause = options.cause
  }
}

interface RegistryRequestOptions {
  accept: string
  invalidResponseMessage: string
  timeoutMs?: number
}

async function request<T>(
  url: string,
  options: RegistryRequestOptions,
  parse: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let responseReceived = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? registryRequestTimeout)

  try {
    const response = await fetch(url, {
      headers: {
        accept: options.accept,
        'user-agent': registryUserAgent,
      },
      signal: controller.signal,
    })
    responseReceived = true

    if (!response.ok) {
      throw new RegistryRequestError(
        'http',
        `Registry request failed with HTTP ${response.status}`,
        { status: response.status },
      )
    }

    return await parse(response)
  }
  catch (error) {
    if (error instanceof RegistryRequestError)
      throw error

    if (timedOut || controller.signal.aborted) {
      throw new RegistryRequestError('timeout', `Registry request timed out after ${options.timeoutMs ?? registryRequestTimeout}ms`, { cause: error })
    }

    if (responseReceived) {
      throw new RegistryRequestError('invalid-response', options.invalidResponseMessage, { cause: error })
    }

    throw new RegistryRequestError('network', 'Registry request could not be completed', { cause: error })
  }
  finally {
    clearTimeout(timeout)
  }
}

export async function requestJson<T>(url: string, timeoutMs?: number): Promise<T> {
  return request(url, {
    accept: 'application/json',
    invalidResponseMessage: 'Registry returned invalid JSON',
    timeoutMs,
  }, async response => await response.json() as T)
}

export async function requestText(url: string, timeoutMs?: number): Promise<string> {
  return request(url, {
    accept: 'text/plain',
    invalidResponseMessage: 'Registry returned an unreadable response',
    timeoutMs,
  }, response => response.text())
}
