export const DEFAULT_CLOUD_API_URL = 'https://sc-overlay-api.antontishin.com'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function normalizeCloudApiUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Cloud API URL must be a string.')
  }

  const candidate = value.trim()
  if (candidate.length === 0 || candidate.length > 2_048) {
    throw new RangeError('Cloud API URL must be between 1 and 2,048 characters.')
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new TypeError('Cloud API URL must be a valid absolute URL.')
  }

  const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new TypeError('Cloud API URL must use HTTPS. HTTP is allowed only for localhost.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Cloud API URL cannot contain credentials, a query, or a fragment.')
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'
  if (
    normalizedPath !== '/' &&
    !/^\/swagger(?:\/index\.html)?$/i.test(normalizedPath) &&
    !/^\/openapi\/v1\.json$/i.test(normalizedPath)
  ) {
    throw new TypeError('Cloud API URL must point to the service root or its Swagger page.')
  }

  return url.origin
}

export function isLoopbackCloudUrl(value: string): boolean {
  return LOOPBACK_HOSTS.has(new URL(value).hostname)
}
