/**
 * Osceola County Property Appraiser Scraper
 *
 * Data source: the search.property-appraiser.org OData API that the site's own
 * parcel search calls (public JSON, no browser):
 *   https://search.property-appraiser.org/api/v1/ParcelMarket?$filter=strap eq '<strap>'
 *
 * The previous implementation drove the JS search page with Puppeteer (120s waits),
 * which was slow and brittle. Querying the underlying API directly returns the owner
 * (Owners) and mailing address (Mailing / MailAddr_* + mailCity/State/Zip/Country)
 * as structured JSON.
 *
 * The "strap" is the parcel id with no separators (e.g. "3627316000000L1000"); the
 * dashed display form "36-27-31-6000-000L-1000" is normalized to it.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_API_URL = 'https://search.property-appraiser.org/api/v1/ParcelMarket'

interface ParcelMarket {
  Owners?: string
  Mailing?: string
  MailAddr_1?: string
  MailAddr_2?: string
  MailAddr_3?: string
  mailCity?: string
  mailState?: string
  mailZip?: string
  mailCountry?: string
}

export default class OsceolaScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Osceola API for ${request.identifier}...`)
      const propertyData = await this.fetchFromApi(request)

      this.validatePropertyData(propertyData)

      const endTime = new Date().toISOString()
      const duration = Date.now() - startTimestamp

      console.log(`[${this.config.id}] Owner: ${propertyData.ownerNames.join(', ')}`)
      console.log(`[${this.config.id}] Address: ${propertyData.mailingAddress}`)

      return {
        success: true,
        data: propertyData,
        metadata: {
          countyId: this.config.id,
          identifier: request.identifier,
          identifierType: request.identifierType,
          startTime,
          endTime,
          duration,
        },
      }
    } catch (error) {
      const endTime = new Date().toISOString()
      const duration = Date.now() - startTimestamp

      console.error(`[${this.config.id}] Scraping failed:`, error)

      const scraperError = error instanceof ScraperError
        ? error
        : new ScraperError(
            ErrorCode.UNKNOWN_ERROR,
            error instanceof Error ? error.message : String(error),
            error,
            this.config.id,
            request.identifier
          )

      return {
        success: false,
        error: {
          code: scraperError.code,
          message: scraperError.message,
          details: scraperError.details,
        },
        metadata: {
          countyId: this.config.id,
          identifier: request.identifier,
          identifierType: request.identifierType,
          startTime,
          endTime,
          duration,
        },
      }
    }
  }

  private async fetchFromApi(request: ScrapeRequest): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    // strap = parcel id with no separators (handles dashed display form too)
    const strap = identifier.trim().toUpperCase().replace(/[\s-]/g, '')
    if (!strap) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid parcel identifier: "${identifier}"`,
        undefined,
        this.config.id,
        identifier
      )
    }

    const baseUrl = this.config.searchUrl || DEFAULT_API_URL
    const filter = `strap eq '${strap}'`.replace(/ /g, '%20').replace(/'/g, '%27')
    const url = `${baseUrl}?$filter=${filter}&$top=1`

    console.log(`[${this.config.id}] GET ${url}`)

    let json: any
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.config.timeout || 30000),
      })
      if (!res.ok) {
        throw new ScraperError(
          ErrorCode.NAVIGATION_FAILED,
          `Osceola API returned HTTP ${res.status}`,
          undefined,
          this.config.id,
          identifier
        )
      }
      json = await res.json()
    } catch (error) {
      if (error instanceof ScraperError) throw error
      throw new ScraperError(
        ErrorCode.NAVIGATION_FAILED,
        `Failed to reach Osceola API: ${error instanceof Error ? error.message : String(error)}`,
        error,
        this.config.id,
        identifier
      )
    }

    const rows: ParcelMarket[] = json?.value || []
    if (rows.length === 0) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const row = rows[0]
    const ownerName = (row.Owners || '').replace(/\s+/g, ' ').trim()
    if (!ownerName) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const mailingAddress = this.buildMailingAddress(row)
    if (!mailingAddress) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Failed to build mailing address from API response',
        row,
        this.config.id,
        identifier
      )
    }

    return {
      ownerNames: [ownerName],
      mailingAddress,
      countyId: this.config.id,
      identifier,
      identifierType,
      scrapedAt: new Date().toISOString(),
    }
  }

  /**
   * Build a single-line mailing address. Prefer the API's combined "Mailing" field
   * (collapsing its padding); fall back to the structured fields.
   * e.g. "332 WALTER DRIVE KESWICK ON L4P 3A7 CANADA"
   */
  private buildMailingAddress(row: ParcelMarket): string {
    const combined = (row.Mailing || '').replace(/\s+/g, ' ').trim()
    if (combined) return combined

    const parts = [
      row.MailAddr_1,
      row.MailAddr_2,
      row.MailAddr_3,
      row.mailCity,
      row.mailState,
      row.mailZip,
      row.mailCountry,
    ]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the OData API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromApi(request)
  }
}
