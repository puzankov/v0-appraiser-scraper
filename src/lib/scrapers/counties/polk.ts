/**
 * Polk County Property Appraiser Scraper
 *
 * Data source: Polk County GIS "Map_Property_Appraiser" ArcGIS MapServer (public
 * JSON, Esri-hosted, no browser):
 *   https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1/query
 *
 * Why not polkflpa.gov? The CamaDisplay page drops connections from Vercel's
 * datacenter IP (net::ERR_CONNECTION_TIMED_OUT) even though it loads from a normal
 * browser. The county GIS Parcels layer exposes the same owner (NAME) and mailing
 * address (MAIL_ADDR_1/2/3) as plain JSON and is reachable from Vercel.
 *
 * The parcel id is the 18-digit PARCELID (no separators); dashed input is normalized.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://gis.polk-county.net/server/rest/services/Map_Property_Appraiser/MapServer/1/query'

interface ParcelAttributes {
  NAME?: string
  MAIL_ADDR_1?: string
  MAIL_ADDR_2?: string
  MAIL_ADDR_3?: string
}

export default class PolkScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Polk GIS for ${request.identifier}...`)
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

    // PARCELID is the 18-digit id with no separators
    const parcelId = identifier.replace(/[^0-9a-zA-Z]/g, '')
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
      where: `PARCELID='${parcelId.replace(/'/g, "''")}'`,
      outFields: 'NAME,MAIL_ADDR_1,MAIL_ADDR_2,MAIL_ADDR_3',
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
          `Polk GIS returned HTTP ${res.status}`,
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
        `Failed to reach Polk GIS: ${error instanceof Error ? error.message : String(error)}`,
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
    const ownerName = (attr.NAME || '').replace(/\s+/g, ' ').trim()
    if (!ownerName) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const mailingAddress = [attr.MAIL_ADDR_1, attr.MAIL_ADDR_2, attr.MAIL_ADDR_3]
      .map((s) => (s || '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0)
      .join('\n')
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

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the GIS REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
