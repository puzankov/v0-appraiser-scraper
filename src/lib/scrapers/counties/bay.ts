/**
 * Bay County Property Appraiser Scraper
 *
 * Data source: Bay County GIS "Parcels" ArcGIS FeatureServer (public JSON, no browser):
 *   https://gis.baycountyfl.gov/arcgis/rest/services/Hosted/Parcels/FeatureServer/0/query
 *
 * Why not qpublic? The Bay report lives on qpublic.schneidercorp.com, behind
 * Cloudflare Bot Management, which 403s Vercel's serverless requests from a
 * datacenter IP. The county GIS exposes owner (a2owname) and mailing address
 * (a3/a4/a5mailaddr + a6mailcity/a7mailst/a8mailzip/a9mailctry) as plain JSON.
 *
 * The parcel id is the dashed value in the "a1renum" field, e.g. "06000-088-000".
 * The layer carries a single owner-name field, so only the primary owner (which may
 * be suffixed "ETAL") is returned.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://gis.baycountyfl.gov/arcgis/rest/services/Hosted/Parcels/FeatureServer/0/query'

interface ParcelAttributes {
  a2owname?: string
  a3mailaddr?: string
  a4mailaddr?: string
  a5mailaddr?: string
  a6mailcity?: string
  a7mailst?: string
  a8mailzip?: string
  a9mailctry?: string
}

export default class BayScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Bay GIS for ${request.identifier}...`)
      const propertyData = await this.fetchFromArcGIS(request)

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

  private async fetchFromArcGIS(request: ScrapeRequest): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    const parcelId = identifier.trim()
    if (!parcelId) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid parcel identifier: "${identifier}"`,
        undefined,
        this.config.id,
        identifier
      )
    }

    const baseUrl = this.config.searchUrl || DEFAULT_ARCGIS_QUERY_URL
    const params = new URLSearchParams({
      where: `a1renum='${parcelId.replace(/'/g, "''")}'`,
      outFields: 'a2owname,a3mailaddr,a4mailaddr,a5mailaddr,a6mailcity,a7mailst,a8mailzip,a9mailctry',
      returnGeometry: 'false',
      f: 'json',
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
          `Bay GIS returned HTTP ${res.status}`,
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
        `Failed to reach Bay GIS: ${error instanceof Error ? error.message : String(error)}`,
        error,
        this.config.id,
        identifier
      )
    }

    if (json?.error) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        `GIS query error: ${json.error.message || JSON.stringify(json.error)}`,
        json.error,
        this.config.id,
        identifier
      )
    }

    const rows: Array<{ attributes: ParcelAttributes }> = json?.features || []
    if (rows.length === 0) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const attr = rows[0].attributes
    const ownerName = (attr.a2owname || '').replace(/\s+/g, ' ').trim()
    if (!ownerName) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const mailingAddress = this.buildMailingAddress(attr)
    if (!mailingAddress) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Failed to build mailing address from GIS attributes',
        attr,
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
   * Assemble a multi-line mailing address, appending the country for foreign owners.
   * e.g. "1012 VIRGINIA COURT\nPANAMA CITY, FL 32404"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    const streetLines = [attr.a3mailaddr, attr.a4mailaddr, attr.a5mailaddr]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    const zipDigits = (attr.a8mailzip || '').replace(/\D/g, '')
    const zip = zipDigits.length > 5 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5, 9)}` : zipDigits

    const cityStateZip = [
      (attr.a6mailcity || '').trim(),
      [(attr.a7mailst || '').trim(), zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')

    const lines = [...streetLines, cityStateZip].filter(Boolean)

    const country = (attr.a9mailctry || '').trim()
    if (country && !/^(USA?|UNITED STATES)$/i.test(country)) {
      lines.push(country)
    }

    return lines.join('\n')
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the GIS REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
