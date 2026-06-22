/**
 * St. Johns County Property Appraiser Scraper
 *
 * Data source: St. Johns County GIS ArcGIS REST API (public, JSON, no browser).
 *   https://www.gis.sjcfl.us/portal_sjcgis/rest/services/Parcel/MapServer/0/query
 *
 * Why not qpublic? The St. Johns appraiser report lives on qpublic.schneidercorp.com,
 * which sits behind Cloudflare Bot Management. From a residential browser it loads
 * fine, but from Vercel's serverless Chromium on an AWS datacenter IP, Cloudflare
 * serves a "Just a moment..." JS challenge that never clears — so Puppeteer scraping
 * times out in production. The county GIS ArcGIS service exposes the same parcel
 * owner + mailing-address data as plain JSON with no bot protection, so we query it
 * directly. This needs no browser and works reliably on Vercel.
 *
 * Note: the GIS parcel layer carries a single owner-name field (PRP_NAME), so only
 * the primary owner is returned; secondary co-owners shown on qpublic are not
 * available from this source.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

// ArcGIS query endpoint (overridable via county config.searchUrl)
const DEFAULT_ARCGIS_QUERY_URL =
  'https://www.gis.sjcfl.us/portal_sjcgis/rest/services/Parcel/MapServer/0/query'

interface ParcelAttributes {
  PRP_NAME?: string
  OWN_ADDRES?: string
  OWN_ADDR_1?: string
  OWN_ADDR_2?: string
  OWN_CITY?: string
  OWN_STATE?: string
  OWN_ZIPCOD?: string
}

export default class StJohnsScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying St. Johns GIS for ${request.identifier}...`)
      const propertyData = await this.fetchFromArcGIS(request)

      // Validate data
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
   * Query the county GIS ArcGIS REST service for the parcel and build owner data.
   */
  private async fetchFromArcGIS(request: ScrapeRequest): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    // STRAP is the clean numeric parcel id used by the GIS layer (no spaces)
    const strap = identifier.replace(/[^0-9]/g, '')
    if (!strap) {
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
      where: `STRAP='${strap}'`,
      outFields: 'PRP_NAME,OWN_ADDRES,OWN_ADDR_1,OWN_ADDR_2,OWN_CITY,OWN_STATE,OWN_ZIPCOD',
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
        `Failed to reach St. Johns GIS: ${error instanceof Error ? error.message : String(error)}`,
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
    const ownerName = (attr.PRP_NAME || '').trim()
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
   * e.g. "164 N RIVER DR\nSAINT AUGUSTINE, FL 32095-0000"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    const streetLines = [attr.OWN_ADDRES, attr.OWN_ADDR_1, attr.OWN_ADDR_2]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    const zipDigits = (attr.OWN_ZIPCOD || '').replace(/\D/g, '')
    const zip = zipDigits.length > 5 ? `${zipDigits.slice(0, 5)}-${zipDigits.slice(5, 9)}` : zipDigits

    const cityStateZip = [
      (attr.OWN_CITY || '').trim(),
      [(attr.OWN_STATE || '').trim(), zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')

    return [...streetLines, cityStateZip].filter(Boolean).join('\n')
  }

  // The BaseScraper template (browser-based) is unused for St. Johns — all data
  // comes from the GIS REST API in scrape() above. These satisfy the abstract
  // contract but are never invoked.
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromArcGIS(request)
  }
}
