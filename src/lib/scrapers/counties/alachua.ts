/**
 * Alachua County Property Appraiser Scraper
 *
 * Data source: Alachua County Property Appraiser GIS "PublicParcel" ArcGIS
 * FeatureServer (public, JSON, no browser):
 *   https://services.arcgis.com/cNo3jpluyt69V8Ek/arcgis/rest/services/PublicParcel/FeatureServer/0/query
 *
 * Why not qpublic? The Alachua report lives on qpublic.schneidercorp.com, which is
 * behind Cloudflare Bot Management. From a residential browser it loads fine, but
 * from Vercel's serverless Chromium on an AWS datacenter IP, Cloudflare serves a
 * "Just a moment..." JS challenge that never clears, so Puppeteer scraping times out
 * in production. The county GIS FeatureServer exposes the same owner + mailing-address
 * data as plain JSON with no bot protection, so we query it directly — no browser.
 *
 * The parcel id is stored (with dashes) in the "Name" field, e.g. "11475-000-000".
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_ARCGIS_QUERY_URL =
  'https://services.arcgis.com/cNo3jpluyt69V8Ek/arcgis/rest/services/PublicParcel/FeatureServer/0/query'

interface ParcelAttributes {
  Owner_Mail_Name?: string
  Owner_Mail_Addr1?: string
  Owner_Mail_Addr2?: string
  Owner_Mail_Addr3?: string
  Owner_Mail_City?: string
  Owner_Mail_State?: string
  Owner_Mail_Zip?: string
}

export default class AlachuaScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Alachua GIS for ${request.identifier}...`)
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
   * Query the ACPA GIS FeatureServer for the parcel and build owner data.
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
      where: `Name='${parcelId.replace(/'/g, "''")}'`,
      outFields:
        'Owner_Mail_Name,Owner_Mail_Addr1,Owner_Mail_Addr2,Owner_Mail_Addr3,Owner_Mail_City,Owner_Mail_State,Owner_Mail_Zip',
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
        `Failed to reach Alachua GIS: ${error instanceof Error ? error.message : String(error)}`,
        error,
        this.config.id,
        identifier
      )
    }

    // ArcGIS returns errors in the body with a 200 status
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
    const ownerName = (attr.Owner_Mail_Name || '').trim()
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
   * e.g. "1733 NW 3RD AVE\nGAINESVILLE, FL 32641"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    const streetLines = [attr.Owner_Mail_Addr1, attr.Owner_Mail_Addr2, attr.Owner_Mail_Addr3]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    const zipDigits = (attr.Owner_Mail_Zip || '').replace(/\D/g, '')
    const zip = zipDigits.length > 5 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5, 9)}` : zipDigits

    const cityStateZip = [
      (attr.Owner_Mail_City || '').trim(),
      [(attr.Owner_Mail_State || '').trim(), zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')

    return [...streetLines, cityStateZip].filter(Boolean).join('\n')
  }

  // The BaseScraper template (browser-based) is unused for Alachua — all data comes
  // from the GIS REST API in scrape() above. These satisfy the abstract contract.
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
