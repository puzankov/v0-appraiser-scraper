/**
 * St. Lucie County Property Appraiser Scraper
 *
 * Data source: the SLCPA public parcels ArcGIS layer (public JSON, no browser):
 *   https://map.paslc.gov/arcgis/rest/services/PROD/SLCPA_PublicParcels/MapServer/0/query
 *
 * Why ArcGIS? The record card UI at apps.paslc.gov/rerecordcard/<id> is an Angular
 * SPA whose data comes from api.paslc.gov keyed by an internal PropertyID, not the
 * parcel id. The public parcels layer is queryable by either the dashed ParcelID or
 * the numeric AccountNumber/PropertyID, and returns owner (Owner1/Owner2/Owner3) and
 * mailing address (MailingAddress1/MailingAddress2/MailingCityStateZip) as plain JSON.
 *
 * The parcel id is the dashed value in "ParcelID", e.g. "1433-701-0371-000-6". A purely
 * numeric identifier (e.g. "11868", the id in the record card URL) is treated as the
 * AccountNumber/PropertyID instead.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://map.paslc.gov/arcgis/rest/services/PROD/SLCPA_PublicParcels/MapServer/0/query'

interface ParcelAttributes {
  Owner1?: string
  Owner2?: string
  Owner3?: string
  MailingAddress1?: string
  MailingAddress2?: string
  MailingCityStateZip?: string
}

export default class StLucieScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying St. Lucie GIS for ${request.identifier}...`)
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

    const value = identifier.trim()
    if (!value) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid parcel identifier: "${identifier}"`,
        undefined,
        this.config.id,
        identifier
      )
    }

    // A purely numeric identifier is the AccountNumber/PropertyID (the id in the
    // record card URL); anything else is the dashed ParcelID.
    const isAccountNumber = /^\d+$/.test(value)
    const where = isAccountNumber
      ? `AccountNumber=${value}`
      : `ParcelID='${value.replace(/'/g, "''")}'`

    const baseUrl = this.config.searchUrl || DEFAULT_ARCGIS_QUERY_URL
    const params = new URLSearchParams({
      where,
      outFields: 'Owner1,Owner2,Owner3,MailingAddress1,MailingAddress2,MailingCityStateZip',
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
          `St. Lucie GIS returned HTTP ${res.status}`,
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
        `Failed to reach St. Lucie GIS: ${error instanceof Error ? error.message : String(error)}`,
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

    const ownerName = [attr.Owner1, attr.Owner2, attr.Owner3]
      .map((s) => (s || '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0)
      .join('\n')
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
   * Assemble a multi-line mailing address. MailingCityStateZip already arrives
   * pre-formatted, e.g. "Fort Pierce, FL 34946-1360".
   * Result: "2006 San Diego AVE\nFort Pierce, FL 34946-1360"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    return [attr.MailingAddress1, attr.MailingAddress2, attr.MailingCityStateZip]
      .map((s) => (s || '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 0)
      .join('\n')
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the GIS REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
