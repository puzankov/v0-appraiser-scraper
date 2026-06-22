/**
 * Clay County Property Appraiser Scraper
 *
 * Data source: Clay County GIS "Parcel" ArcGIS MapServer (public, JSON, no browser):
 *   https://maps.claycountygov.com/server/rest/services/Parcel/MapServer/0/query
 *
 * Why not qpublic? The Clay report lives on qpublic.schneidercorp.com, behind
 * Cloudflare Bot Management. From Vercel's serverless Chromium (AWS datacenter IP)
 * Cloudflare serves a "Just a moment..." JS challenge that never clears, so the
 * Puppeteer scrape times out in production while working locally. The county GIS
 * exposes the same owner + mailing-address data as plain JSON with no bot
 * protection, so we query it directly — no browser.
 *
 * Parcel id is the dashed value in the "ParcelDisp" field, e.g. "31-08-24-007851-058-00".
 * The layer carries a single owner-name field (Name), so only the primary owner is
 * returned; additional co-owners shown on qpublic are not available from this source.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://maps.claycountygov.com/server/rest/services/Parcel/MapServer/0/query'

interface ParcelAttributes {
  Name?: string
  Address1?: string
  Address2?: string
  Address3?: string
  City?: string
  StateProvince?: string
  ZipCode?: string
}

export default class ClayScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Clay GIS for ${request.identifier}...`)
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

  /**
   * Query the Clay County GIS Parcel layer and build owner data.
   */
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
      where: `ParcelDisp='${parcelId.replace(/'/g, "''")}'`,
      outFields: 'Name,Address1,Address2,Address3,City,StateProvince,ZipCode',
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
          `GIS request failed with HTTP ${res.status}`,
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
        `Failed to reach Clay GIS: ${error instanceof Error ? error.message : String(error)}`,
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

    const features: Array<{ attributes: ParcelAttributes }> = json?.features || []
    if (features.length === 0) {
      throw createNoResultsError(this.config.id, identifier)
    }

    const attr = features[0].attributes
    const ownerName = (attr.Name || '').trim()
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
   * Assemble a multi-line mailing address from the GIS owner-address fields.
   * e.g. "637 Ivory Palm Rd\nOrange Park, FL 32073-1691"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    const streetLines = [attr.Address1, attr.Address2, attr.Address3]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    const zipDigits = (attr.ZipCode || '').replace(/\D/g, '')
    const zip = zipDigits.length > 5 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5, 9)}` : zipDigits

    const cityStateZip = [
      (attr.City || '').trim(),
      [(attr.StateProvince || '').trim(), zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')

    return [...streetLines, cityStateZip].filter(Boolean).join('\n')
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the GIS REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
