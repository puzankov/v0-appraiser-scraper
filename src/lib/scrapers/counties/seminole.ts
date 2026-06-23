/**
 * Seminole County Property Appraiser Scraper
 *
 * Data source: the statewide FL Department of Revenue cadastral ArcGIS FeatureServer
 * (Esri-hosted public JSON, no browser), filtered to Seminole (CO_NO = 69):
 *   https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query
 *
 * Why not scpafl.org? The Seminole appraiser site is a Blazor app — the parcel
 * details page server-renders the owner + situs but loads the mailing address via
 * interactivity (SignalR), so it isn't available from a simple request, and its map
 * service endpoint isn't publicly documented. The DOR cadastral carries the owner
 * (OWN_NAME) and mailing address (OWN_ADDR1/2 + OWN_CITY/STATE/ZIPCD) as plain JSON.
 *
 * Note: the DOR cadastral is the annual NAL roll (a periodic snapshot), so very recent
 * ownership changes may lag the live appraiser site. PARCEL_ID is the id with no
 * separators (dashed input is normalized); CO_NO scopes the query to Seminole so the
 * (non-globally-unique) parcel id can't match another county.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query'

// FL DOR county number for Seminole
const SEMINOLE_CO_NO = 69

interface ParcelAttributes {
  OWN_NAME?: string
  OWN_ADDR1?: string
  OWN_ADDR2?: string
  OWN_CITY?: string
  OWN_STATE?: string
  OWN_ZIPCD?: number | string
}

export default class SeminoleScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying DOR cadastral for ${request.identifier}...`)
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

    // PARCEL_ID has no separators
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
      where: `CO_NO=${SEMINOLE_CO_NO} AND PARCEL_ID='${parcelId.replace(/'/g, "''")}'`,
      outFields: 'OWN_NAME,OWN_ADDR1,OWN_ADDR2,OWN_CITY,OWN_STATE,OWN_ZIPCD',
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
          `DOR cadastral returned HTTP ${res.status}`,
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
        `Failed to reach DOR cadastral: ${error instanceof Error ? error.message : String(error)}`,
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
    const ownerName = (attr.OWN_NAME || '').replace(/\s+/g, ' ').trim()
    if (!ownerName) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const mailingAddress = this.buildMailingAddress(attr)
    if (!mailingAddress) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Failed to build mailing address from cadastral attributes',
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
   * Assemble the mailing address: street line(s) + "CITY, ST ZIP".
   * e.g. "335 SAN GABRIEL ST\nWINTER SPGS, FL 32708"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    const streetLines = [attr.OWN_ADDR1, attr.OWN_ADDR2]
      .map((s) => (s || '').toString().trim())
      .filter((s) => s.length > 0)

    const zipDigits = String(attr.OWN_ZIPCD ?? '').replace(/\D/g, '')
    const zip = zipDigits === '0' ? '' : zipDigits.length > 5 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5, 9)}` : zipDigits

    const cityStateZip = [
      (attr.OWN_CITY || '').trim(),
      [(attr.OWN_STATE || '').trim(), zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')

    return [...streetLines, cityStateZip].filter(Boolean).join('\n')
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the cadastral REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
