/**
 * URL helpers shared by the annotation forms (where users type) and the
 * places that hand a URL to `system.openExternal` (where main rejects
 * non-strict URLs via zod).
 */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Returns a URL string with an `https://` scheme prepended if the input
 * doesn't already have one. Empty / whitespace-only strings come back
 * unchanged so callers can decide what to do with them.
 *
 *   normalizeUrl('example.com')          → 'https://example.com'
 *   normalizeUrl('http://example.com')   → 'http://example.com'
 *   normalizeUrl('ftp://files.foo.bar')  → 'ftp://files.foo.bar'
 *   normalizeUrl('  staging.foo.bar  ')  → 'https://staging.foo.bar'
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (HAS_SCHEME.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** Strip the scheme + trailing slash for compact display in node chrome. */
export function displayUrl(input: string): string {
  return input.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}
