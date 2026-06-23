/**
 * Martin County Property Appraiser Scraper
 *
 * Data source: the pamartinfl.gov real-property search, which returns JSON when
 * called with format=json (the same endpoint the site's own search UI uses):
 *   https://www.pamartinfl.gov/app/search/real-property?format=json&searchField=parcelId&search=<pin>
 *
 * Plain JSON, no browser. Owner = PrimaryOwner (+ SecondaryOwner); mailing address =
 * MailAddrLine1/2/3 + MailCityStateZip (+ MailCountry for foreign owners).
 *
 * The parcel id is the dashed PIN, e.g. "30-38-42-006-005-05010-9".
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_SEARCH_URL = 'https://www.pamartinfl.gov/app/search/real-property'

interface ParcelRecord {
  PIN?: string
  PrimaryOwner?: string
  SecondaryOwner?: string
  MailAddrLine1?: string
  MailAddrLine2?: string
  MailAddrLine3?: string
  MailCityStateZip?: string
  MailCountry?: string
}

export default class MartinScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Martin search for ${request.identifier}...`)
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

    const pin = identifier.trim()
    if (!pin) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid parcel identifier: "${identifier}"`,
        undefined,
        this.config.id,
        identifier
      )
    }

    const baseUrl = this.config.searchUrl || DEFAULT_SEARCH_URL
    const params = new URLSearchParams({
      format: 'json',
      direction: 'asc',
      limit: '20',
      offset: '0',
      orderBy: 'pin',
      search: pin,
      searchField: 'parcelId',
    })
    const url = `${baseUrl}?${params.toString()}`

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
          `Martin search returned HTTP ${res.status}`,
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
        `Failed to reach Martin search: ${error instanceof Error ? error.message : String(error)}`,
        error,
        this.config.id,
        identifier
      )
    }

    const records: ParcelRecord[] = json?.records || []
    if (records.length === 0) {
      throw createNoResultsError(this.config.id, identifier)
    }

    // Prefer the record whose PIN matches exactly; fall back to the first result
    const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()
    const record = records.find((r) => r.PIN && norm(r.PIN) === norm(pin)) || records[0]

    const ownerName = [record.PrimaryOwner, record.SecondaryOwner]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)
      .join('\n')
    if (!ownerName) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const mailingAddress = this.buildMailingAddress(record)
    if (!mailingAddress) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Failed to build mailing address from search result',
        record,
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
   * Assemble the mailing address, appending the country for foreign owners.
   * e.g. "5902 SE RIVERBOAT DR\nSTUART FL 34997"
   */
  private buildMailingAddress(record: ParcelRecord): string {
    const lines = [record.MailAddrLine1, record.MailAddrLine2, record.MailAddrLine3, record.MailCityStateZip]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    const country = (record.MailCountry || '').trim()
    if (country && !/^(USA?|UNITED STATES)$/i.test(country)) {
      lines.push(country)
    }

    return lines.join('\n')
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the JSON search API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromApi(request)
  }
}
