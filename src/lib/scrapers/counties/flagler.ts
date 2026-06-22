/**
 * Flagler County Property Appraiser Scraper
 *
 * Data source: Flagler County (Palm Coast) "FlaglerCountyParcels" ArcGIS MapServer
 * (public, JSON, no browser):
 *   https://gis.palmcoast.gov/hosting/rest/services/External/FlaglerCountyParcels/MapServer/1/query
 *
 * Why not qpublic? The Flagler report lives on qpublic.schneidercorp.com, behind
 * Cloudflare Bot Management. From Vercel's serverless Chromium (AWS datacenter IP)
 * Cloudflare serves a "Just a moment..." JS challenge that never clears, so the
 * Puppeteer scrape times out in production while working locally. This GIS service
 * exposes the same owner + mailing-address data as plain JSON with no bot protection.
 *
 * Parcel id is the dashed value in PARCELNO, e.g. "07-11-31-7028-00300-0190".
 * The owner is in file_as_name; secondary name lines (e.g. "TRUSTEE", "C/O ...") land
 * in addr_line1 ahead of the street, so non-numeric leading address lines are treated
 * as owner continuation.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://gis.palmcoast.gov/hosting/rest/services/External/FlaglerCountyParcels/MapServer/1/query'

interface ParcelAttributes {
  file_as_name?: string
  addr_line1?: string
  addr_line2?: string
  addr_line3?: string
  addr_city?: string
  addr_state?: string
  zip?: string
}

export default class FlaglerScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Flagler GIS for ${request.identifier}...`)
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
   * Query the Flagler County GIS parcel layer and build owner data.
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
      where: `PARCELNO='${parcelId.replace(/'/g, "''")}'`,
      outFields: 'file_as_name,addr_line1,addr_line2,addr_line3,addr_city,addr_state,zip',
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
        `Failed to reach Flagler GIS: ${error instanceof Error ? error.message : String(error)}`,
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
    const { ownerName, mailingAddress } = this.buildOwnerAndAddress(attr)

    if (!ownerName) {
      throw createNoResultsError(this.config.id, identifier)
    }
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
   * Split owner vs. mailing address. file_as_name is the owner; leading non-numeric
   * address lines (e.g. "TRUSTEE", "C/O ...") are owner continuation, and the address
   * begins at the first line that starts with a street number.
   * e.g. owner "CORAL CREST LLC\nTRUSTEE", address "1718 CAPITOL AVENUE\nCHEYENNE, WY 82001"
   */
  private buildOwnerAndAddress(attr: ParcelAttributes): { ownerName: string; mailingAddress: string } {
    const ownerParts: string[] = []
    const baseName = (attr.file_as_name || '').trim()
    if (baseName) ownerParts.push(baseName)

    const addressParts: string[] = []
    let inAddress = false
    for (const raw of [attr.addr_line1, attr.addr_line2, attr.addr_line3]) {
      const line = (raw || '').trim()
      if (!line) continue
      if (!inAddress && !/^\d/.test(line)) {
        ownerParts.push(line)
      } else {
        inAddress = true
        addressParts.push(line)
      }
    }

    const zipDigits = (attr.zip || '').replace(/\D/g, '')
    const zip = zipDigits.length > 5 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5, 9)}` : zipDigits
    const cityStateZip = [
      (attr.addr_city || '').trim(),
      [(attr.addr_state || '').trim(), zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')
    if (cityStateZip) addressParts.push(cityStateZip)

    return {
      ownerName: ownerParts.join('\n'),
      mailingAddress: addressParts.join('\n'),
    }
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the GIS REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
