/**
 * API request and response types
 */

import { ScrapeRequest, ScrapeResult } from './scraper'

// POST /api/scrape request body
export interface ScrapeApiRequest extends ScrapeRequest {}

// POST /api/scrape response
export interface ScrapeApiResponse extends ScrapeResult {}

// GET /api/counties response
export interface CountiesListResponse {
  counties: CountySummary[]
}

// Summary of a county (without full config details)
export interface CountySummary {
  id: string
  name: string
  state: string
  identifierTypes: string[]
  enabled: boolean
}

// Error response format
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: any
  }
}
