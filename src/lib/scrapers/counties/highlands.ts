/**
 * Highlands County Property Appraiser Scraper
 *
 * Data source: hcpao.org property record page (server-rendered HTML, no browser,
 * no bot protection):
 *   https://www.hcpao.org/Search/Parcel/{PIN}
 *
 * The public parcel id is the dashed "alternate key" format, e.g.
 * "C-04-34-28-110-1950-0600", but the record URL uses a PIN where the first three
 * numeric groups (range, township, section) are reversed and the leading book-type
 * letter is moved to the end:
 *   C-04-34-28-110-1950-0600  ->  28-34-04 + 110-1950-0600 + C  ->  28340411019500600C
 *
 * The page is plain HTML, so we fetch and parse it directly — no Puppeteer/Cloudflare.
 */

import https from 'node:https'
import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

const DEFAULT_SEARCH_URL = 'https://www.hcpao.org/Search/Parcel'

export default class HighlandsScraper extends BaseScraper {
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    try {
      console.log(`[${this.config.id}] Looking up ${request.identifier}...`)
      const propertyData = await this.fetchRecord(request)

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
   * Convert the dashed alternate-key parcel id into the hcpao.org URL PIN.
   * "C-04-34-28-110-1950-0600" -> "28340411019500600C"
   * If the id is already in PIN form (no dashes), it is returned uppercased.
   */
  private toPin(identifier: string): string {
    const raw = identifier.trim().toUpperCase()
    const parts = raw.split('-').filter(Boolean)
    if (parts.length === 0) return raw

    let prefix = ''
    let segs = parts
    if (/^[A-Z]+$/.test(parts[0])) {
      prefix = parts[0]
      segs = parts.slice(1)
    }

    if (segs.length >= 3) {
      const reordered = [segs[2], segs[1], segs[0], ...segs.slice(3)]
      return reordered.join('') + prefix
    }
    return segs.join('') + prefix
  }

  /**
   * Turn an HTML fragment into trimmed, non-empty text lines (split on <br>).
   */
  private htmlToLines(fragment: string): string[] {
    return fragment
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  /**
   * GET over https. hcpao.org serves a valid Let's Encrypt cert but omits the
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
            Accept: 'text/html',
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

  private async fetchRecord(request: ScrapeRequest): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    const pin = this.toPin(identifier)
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
    const url = `${baseUrl}/${encodeURIComponent(pin)}`

    console.log(`[${this.config.id}] GET ${url}`)

    let httpStatus = 0
    let httpBody = ''
    try {
      const res = await this.httpsGet(url, this.config.timeout || 30000)
      httpStatus = res.status
      httpBody = res.body
    } catch (error) {
      throw new ScraperError(
        ErrorCode.NAVIGATION_FAILED,
        `Failed to reach hcpao.org: ${error instanceof Error ? error.message : String(error)}`,
        error,
        this.config.id,
        identifier
      )
    }

    if (httpStatus === 404) {
      throw createNoResultsError(this.config.id, identifier)
    }
    if (httpStatus !== 200) {
      throw new ScraperError(
        ErrorCode.NAVIGATION_FAILED,
        `hcpao.org returned HTTP ${httpStatus}`,
        undefined,
        this.config.id,
        identifier
      )
    }

    // Owners: between "<b>Owners:</b>" and the "Mailing Address" header.
    const ownerMatch = httpBody.match(/<b>\s*Owners?\s*:?\s*<\/b>\s*<br\s*\/?>([\s\S]*?)<b>\s*Mailing Address/i)
    // Mailing Address: between its header and the next <hr> or <b> block.
    const mailMatch = httpBody.match(/<b>\s*Mailing Address\s*:?\s*<\/b>\s*<br\s*\/?>([\s\S]*?)(?:<hr|<b>)/i)

    const ownerLines = ownerMatch ? this.htmlToLines(ownerMatch[1]) : []
    const addressLines = mailMatch ? this.htmlToLines(mailMatch[1]) : []

    if (ownerLines.length === 0) {
      throw createNoResultsError(this.config.id, identifier)
    }
    if (addressLines.length === 0) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Failed to extract mailing address',
        undefined,
        this.config.id,
        identifier
      )
    }

    return {
      ownerNames: [ownerLines.join('\n')],
      mailingAddress: addressLines.join('\n'),
      countyId: this.config.id,
      identifier,
      identifierType,
      scrapedAt: new Date().toISOString(),
    }
  }

  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // unused — data comes from the hcpao.org HTML fetch in scrape()
  }

  protected async extractPropertyData(_page: Page, request: ScrapeRequest): Promise<PropertyOwnerData> {
    return this.fetchRecord(request)
  }
}
