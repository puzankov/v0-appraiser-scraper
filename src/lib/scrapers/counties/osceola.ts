/**
 * Osceola County Property Appraiser Scraper
 *
 * Data source: Osceola County GIS "Parcels" ArcGIS FeatureServer (public JSON,
 * Esri-hosted, no browser, no Cloudflare):
 *   https://gis.osceola.org/hosting/rest/services/Parcels/FeatureServer/3/query
 *
 * Why not search.property-appraiser.org? That site (and every property-appraiser.org
 * / county-taxes.com host) sits behind Cloudflare Bot Management, which 403s
 * server-side requests from Vercel's datacenter IP. The statewide FDOR cadastral is
 * reachable but is a stale annual snapshot and can't represent foreign postal codes.
 * The county GIS layer has current owner (Owner1/2/3) and full billing address
 * including Country, so foreign (e.g. Canadian) mailing addresses come through intact.
 *
 * The parcel id is the "Strap" (no separators, e.g. "3627316000000L1000"); the dashed
 * display form "36-27-31-6000-000L-1000" is normalized to it.
 */

import https from 'node:https'
import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_API_URL = 'https://gis.osceola.org/hosting/rest/services/Parcels/FeatureServer/3/query'

interface ParcelAttributes {
  Owner1?: string
  Owner2?: string
  Owner3?: string
  BillingAdd?: string
  BillingA_1?: string
  BillingA_2?: string
  City?: string
  State?: string
  Zip?: string
  Country?: string
}

export default class OsceolaScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Querying Osceola GIS for ${request.identifier}...`)
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

  /**
   * GET over https. gis.osceola.org serves a valid Entrust cert but omits the
   * intermediate from the chain, so Node's global fetch fails with
   * UNABLE_TO_VERIFY_LEAF_SIGNATURE (browsers/curl recover via AIA). We use
   * node:https with relaxed verification scoped to this single request.
   */
  private httpsGet(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          rejectUnauthorized: false,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c as Buffer))
          res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }))
        }
      )
      req.on('error', reject)
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)))
    })
  }

  private async fetchFromApi(request: ScrapeRequest): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    // Strap = parcel id with no separators (handles the dashed display form too)
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
    const params = new URLSearchParams({
      where: `Strap='${strap.replace(/'/g, "''")}'`,
      outFields: 'Owner1,Owner2,Owner3,BillingAdd,BillingA_1,BillingA_2,City,State,Zip,Country',
      returnGeometry: 'false',
      f: 'json',
    })
    const url = `${baseUrl}?${params.toString()}`

    console.log(`[${this.config.id}] GET ${url}`)

    let json: any
    try {
      const { status, body } = await this.httpsGet(url, this.config.timeout || 30000)
      if (status !== 200) {
        throw new ScraperError(
          ErrorCode.NAVIGATION_FAILED,
          `Osceola GIS returned HTTP ${status}`,
          undefined,
          this.config.id,
          identifier
        )
      }
      json = JSON.parse(body)
    } catch (error) {
      if (error instanceof ScraperError) throw error
      throw new ScraperError(
        ErrorCode.NAVIGATION_FAILED,
        `Failed to reach Osceola GIS: ${error instanceof Error ? error.message : String(error)}`,
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
      .map((s) => (s || '').trim())
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
   * Build the mailing address from the billing fields, appending the country for
   * foreign addresses. e.g. "332 WALTER DRIVE\nKESWICK, ON L4P 3A7\nCANADA"
   */
  private buildMailingAddress(attr: ParcelAttributes): string {
    const streetLines = [attr.BillingAdd, attr.BillingA_1, attr.BillingA_2]
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0)

    const cityStateZip = [
      (attr.City || '').trim(),
      [(attr.State || '').trim(), (attr.Zip || '').trim()].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ')

    const lines = [...streetLines, cityStateZip].filter(Boolean)

    const country = (attr.Country || '').trim()
    if (country && !/^(USA?|UNITED STATES)$/i.test(country)) {
      lines.push(country)
    }

    return lines.join('\n')
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the GIS REST API in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchFromApi(request)
  }
}
