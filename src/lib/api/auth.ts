/**
 * API Authentication utilities
 */

import { NextRequest } from 'next/server'

/**
 * Validate API key from request headers or query params
 */
export function validateApiKey(request: NextRequest): boolean {
  const configuredApiKey = process.env.API_KEY

  // If no API key is configured, allow all requests (development mode)
  if (!configuredApiKey) {
    console.warn('[Auth] No API_KEY configured in environment variables. All requests will be allowed.')
    return true
  }

  // Allow internal requests from testing UI
  const referer = request.headers.get('referer')
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')

  if (referer || origin) {
    const requestOrigin = referer || origin || ''
    // Check if request is from same domain (internal testing UI)
    if (host && requestOrigin.includes(host)) {
      console.log('[Auth] Internal request from testing UI - bypassing API key check')
      return true
    }
  }

  // Check header first (recommended)
  const headerApiKey = request.headers.get('x-api-key') || request.headers.get('X-API-Key')

  if (headerApiKey && headerApiKey === configuredApiKey) {
    return true
  }

  // Check query parameter as fallback
  const url = new URL(request.url)
  const queryApiKey = url.searchParams.get('apiKey')

  if (queryApiKey && queryApiKey === configuredApiKey) {
    return true
  }

  return false
}

/**
 * Create unauthorized response
 */
export function createUnauthorizedResponse() {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing API key. Please provide a valid API key in X-API-Key header or apiKey query parameter.',
        details: null
      }
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}
