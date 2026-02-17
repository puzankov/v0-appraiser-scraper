/**
 * Main scraping API endpoint
 * POST /api/scrape - Scrape property data from a county website
 * GET /api/scrape - API documentation
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateScrapeRequest } from '@/lib/scrapers/utils/validators'
import { loadCountyConfig } from '@/lib/config/counties'
import { getScraper } from '@/lib/scrapers/base/ScraperFactory'
import { ScrapeApiRequest, ScrapeApiResponse } from '@/types/api'
import { ScraperError, ErrorCode } from '@/lib/scrapers/utils/errors'
import { ZodError } from 'zod'
import { validateApiKey, createUnauthorizedResponse } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Vercel function timeout

/**
 * POST /api/scrape
 * Scrape property data from a county appraiser website
 */
export async function POST(request: NextRequest) {
  try {
    // Validate API key
    if (!validateApiKey(request)) {
      return createUnauthorizedResponse()
    }

    // Parse request body
    const body = await request.json()

    // Validate request
    let scrapeRequest: ScrapeApiRequest
    try {
      scrapeRequest = validateScrapeRequest(body)
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: ErrorCode.VALIDATION_ERROR,
              message: 'Invalid request data',
              details: error.errors,
            },
          },
          { status: 400 }
        )
      }
      throw error
    }

    // Load county configuration
    const countyConfig = loadCountyConfig(scrapeRequest.countyId)

    // Get scraper instance
    const scraper = await getScraper(countyConfig)

    // Execute scraping
    console.log(`[API] Starting scrape for ${scrapeRequest.countyId}:${scrapeRequest.identifier}`)
    const result = await scraper.scrape(scrapeRequest)

    // Return result
    const statusCode = result.success ? 200 : 500
    return NextResponse.json(result, { status: statusCode })

  } catch (error) {
    console.error('[API] Scraping error:', error)

    // Handle ScraperError
    if (error instanceof ScraperError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          metadata: {
            countyId: error.countyId,
            identifier: error.identifier,
            identifierType: 'unknown',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: 0,
          },
        } as ScrapeApiResponse,
        { status: error.code === ErrorCode.COUNTY_NOT_FOUND ? 404 : 500 }
      )
    }

    // Handle generic errors
    return NextResponse.json(
      {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: error instanceof Error ? error.message : 'An unknown error occurred',
          details: error,
        },
        metadata: {
          countyId: 'unknown',
          identifier: 'unknown',
          identifierType: 'unknown',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: 0,
        },
      } as ScrapeApiResponse,
      { status: 500 }
    )
  }
}

/**
 * GET /api/scrape
 * API documentation
 */
export async function GET() {
  return NextResponse.json({
    name: 'Florida Property Appraiser Scraper API',
    version: '1.0.0',
    endpoints: {
      scrape: {
        method: 'POST',
        path: '/api/scrape',
        description: 'Scrape property owner data from a Florida county appraiser website',
        requestBody: {
          countyId: 'string (required) - County identifier (e.g., "miami-dade")',
          identifierType: 'string (required) - Type of identifier: "parcelId", "folio", "address", or "ownerName"',
          identifier: 'string (required) - Property identifier value',
        },
        example: {
          countyId: 'miami-dade',
          identifierType: 'parcelId',
          identifier: '12345',
        },
      },
      counties: {
        method: 'GET',
        path: '/api/counties',
        description: 'List all available counties',
      },
    },
  })
}
