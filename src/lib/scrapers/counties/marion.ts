/**
 * Marion County Property Appraiser Scraper
 * Flow:
 *   1. Search page:  https://www.pa.marion.fl.us/PropertySearch.aspx?SearchBy=ParcelR&Parms={parcelId}
 *   2. The result row links to the property record card with the INTERNAL prime key
 *      (not the parcel id): https://www.pa.marion.fl.us/PRC.aspx?key={primeKey}&YR=...
 *   3. Record card (PRC.aspx) has owner + mailing address in one td, separated by <br>.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class MarionScraper extends BaseScraper {
  /**
   * Step 1+2: run the parcel search, then follow the result link (which carries the
   * internal prime key) to the property record card.
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Marion County navigation',
        undefined,
        this.config.id
      )
    }

    const identifier = request.identifier.trim()
    const prcBase = this.config.searchUrl.replace(/PropertySearch\.aspx$/i, 'PRC.aspx')

    // A real parcel id contains non-digit separators (e.g. "1815-033-003"); a bare
    // numeric value is the internal prime key, which maps straight to PRC.aspx?key=.
    const looksLikeParcelId = /\D/.test(identifier)

    let prcUrl: string | null
    if (looksLikeParcelId) {
      const searchUrl = `${this.config.searchUrl}?SearchBy=ParcelR&Parms=${encodeURIComponent(identifier)}`
      console.log(`[${this.config.id}] Searching: ${searchUrl}`)
      await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout || 30000,
      })

      // Find the PRC.aspx record-card link. Prefer the result row whose link text
      // matches the parcel id; fall back to the first PRC link on the page.
      prcUrl = await page.evaluate((pid: string) => {
        const anchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[]
        const isPrc = (a: HTMLAnchorElement) => /PRC\.aspx\?key=/i.test(a.getAttribute('href') || '')
        const exact = anchors.find((a) => isPrc(a) && (a.textContent || '').trim() === pid)
        const match = exact || anchors.find(isPrc)
        return match ? match.href : null
      }, identifier)

      if (!prcUrl) {
        throw createNoResultsError(this.config.id, identifier)
      }
    } else {
      // Bare numeric identifier = internal prime key → record card directly
      prcUrl = `${prcBase}?key=${encodeURIComponent(identifier)}&YR=2026&mName=False&mSitus=False`
    }

    console.log(`[${this.config.id}] Opening record card: ${prcUrl}`)
    await page.goto(prcUrl, {
      waitUntil: 'networkidle2',
      timeout: this.config.timeout || 30000,
    })
  }

  /**
   * Override the main scrape method to pass request to navigation
   */
  async scrape(request: ScrapeRequest): Promise<any> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    let browser: any = null

    try {
      console.log(`[${this.config.id}] Setting up browser...`)
      browser = await this.setupBrowser()

      const { createPage } = await import('../utils/browser')
      const page = await createPage(browser)

      // Navigate directly to property page
      await this.navigateToSearch(page, request)

      // Wait for content to load
      console.log(`[${this.config.id}] Waiting for property data...`)
      await page.waitForSelector('table', { timeout: this.config.timeout || 10000 })

      // Extract property data
      console.log(`[${this.config.id}] Extracting property data...`)
      const propertyData = await this.extractPropertyData(page, request)

      // Validate data
      this.validatePropertyData(propertyData)

      const endTime = new Date().toISOString()
      const duration = Date.now() - startTimestamp

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
    } finally {
      if (browser) {
        const { closeBrowser } = await import('../utils/browser')
        await closeBrowser(browser)
      }
    }
  }

  /**
   * Marion doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Marion property details page
   * Owner and address are in the same td element (width="33%") after "Property Information"
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        // Helper to decode HTML entities and preserve newlines
        const htmlToText = (html: string): string => {
          // Replace <br> tags with a unique marker
          const withMarkers = html.replace(/<br\s*\/?>/gi, '|||NEWLINE|||')

          // Create temporary element to decode HTML entities
          const temp = document.createElement('div')
          temp.innerHTML = withMarkers

          // Get text content (automatically decodes &amp; etc.)
          const decoded = temp.textContent || ''

          // Split by marker, clean up, and rejoin
          return decoded
            .split('|||NEWLINE|||')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
        }

        let ownerName = ''
        let mailingAddress = ''

        // Find all td elements with width="33%"
        const allTds = Array.from(document.querySelectorAll('td[width="33%"]'))

        // Look for the td that contains owner information
        // It should be the first td in the row after "Property Information"
        for (const td of allTds) {
          const innerHTML = td.innerHTML || ''

          // Check if this td contains <br> tags (indicating owner + address)
          if (innerHTML.includes('<br>') && !innerHTML.includes('Prime Key')) {
            // Extract and split the content
            const fullText = htmlToText(innerHTML)
            const lines = fullText.split('\n')

            if (lines.length > 0) {
              // Separate owner name(s) from the mailing address.
              // The block is always: owner line(s), then a street line, then a
              // "CITY ST ZIP" line. Anchor on the trailing CITY/STATE/ZIP line
              // (the street is the line just before it; everything above is the
              // owner). This is robust even when an owner name starts with a digit
              // (e.g. "1255 NW 23RD AVE LAND TRUST"), which a naive
              // "first numeric line = address" rule misclassifies.
              // Require the 2-letter state to be its own token (preceded by start/space)
              // so a US "CITY ST 12345" line matches but "PO BOX 70584" does NOT
              // (its trailing "OX 70584" would otherwise look like a state+zip).
              const cityStateZip = /(?:^|\s)[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/
              let czIdx = -1
              for (let i = lines.length - 1; i >= 0; i--) {
                if (cityStateZip.test(lines[i])) {
                  czIdx = i
                  break
                }
              }

              let ownerParts: string[]
              let addressParts: string[]
              if (czIdx >= 1) {
                // Address = street line + city/state/zip; owner = everything before
                ownerParts = lines.slice(0, czIdx - 1)
                addressParts = lines.slice(czIdx - 1)
              } else {
                // No US city/state/zip line (e.g. a foreign address). Find where the
                // address begins by scanning past the first line (always owner) for a
                // street-number or PO-box line; otherwise assume only the first line is
                // the owner and the rest is the address.
                const looksLikeAddressStart = (line: string) =>
                  /^\d/.test(line) || /^(P\.?\s?O\.?\s?BOX|POST\s+OFFICE\s+BOX|BOX\s)/i.test(line)
                let addrStart = -1
                for (let i = 1; i < lines.length; i++) {
                  if (looksLikeAddressStart(lines[i])) {
                    addrStart = i
                    break
                  }
                }
                if (addrStart === -1) addrStart = 1
                ownerParts = lines.slice(0, addrStart)
                addressParts = lines.slice(addrStart)
              }

              ownerName = ownerParts.join('\n')
              mailingAddress = addressParts.join('\n')

              // Break once we find the owner info
              break
            }
          }
        }

        return {
          ownerName,
          mailingAddress
        }
      })

      // Check if we found the required data
      if (!data.ownerName) {
        throw createNoResultsError(this.config.id, identifier)
      }

      if (!data.mailingAddress) {
        throw new ScraperError(
          ErrorCode.EXTRACTION_FAILED,
          'Failed to extract mailing address',
          undefined,
          this.config.id,
          identifier
        )
      }

      // Return the structured data
      return {
        ownerNames: [data.ownerName],
        mailingAddress: data.mailingAddress,
        countyId: this.config.id,
        identifier,
        identifierType,
        scrapedAt: new Date().toISOString(),
      }
    } catch (error) {
      if (error instanceof ScraperError) {
        throw error
      }
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        `Failed to extract property data: ${error instanceof Error ? error.message : String(error)}`,
        error,
        this.config.id,
        identifier
      )
    }
  }
}
