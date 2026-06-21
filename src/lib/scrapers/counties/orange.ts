/**
 * Orange County Property Appraiser Scraper
 * User-facing site: https://ocpaweb.ocpafl.org/parcelsearch/Parcel%20ID/{parcelId} (Angular SPA)
 *
 * The SPA loads parcel data from an encrypted Azure API, which is impractical to
 * scrape directly. Instead we hit the server-rendered "printer friendly" record,
 * which returns the full owner/address data as static HTML:
 *   https://ocpaservices.ocpafl.org/Searches/ParcelInfoPrinterFriendly.aspx/PDF/False/PID/{parcelId}
 *
 * Note: that page gates a #view div behind reCAPTCHA via `display:none`, but the
 * data is present in the HTML regardless, so we extract via textContent (not innerText).
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class OrangeScraper extends BaseScraper {
  /**
   * Orange navigates directly to the printer-friendly record by PID
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Orange County navigation',
        undefined,
        this.config.id
      )
    }

    const url = `${this.config.searchUrl}/PDF/False/PID/${encodeURIComponent(request.identifier)}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.timeout || 60000,
    })

    // The record fieldsets are server-rendered; wait until they're present
    await page.waitForSelector('fieldset legend', { timeout: this.config.timeout || 60000 })
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

      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      // Navigate directly to the printer-friendly record
      await this.navigateToSearch(page, request)

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
   * Orange doesn't need a separate search step - navigation handles it
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from the Orange printer-friendly record.
   * Owner sits under <legend>Names</legend>; address under <legend>Mailing Address</legend>.
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      const data = await page.evaluate(() => {
        // Convert a fieldset's value HTML into trimmed, non-empty lines.
        // Uses textContent so it works even though the data lives inside a
        // display:none #view div (innerText would return nothing).
        const htmlToLines = (html: string): string[] => {
          const withMarkers = html.replace(/<br\s*\/?>/gi, '|||NL|||')
          const temp = document.createElement('div')
          temp.innerHTML = withMarkers
          const decoded = temp.textContent || ''
          return decoded
            .split('|||NL|||')
            .map(line => line.trim())
            .filter(line => line.length > 0)
        }

        // Return the value lines of the first fieldset whose legend matches.
        const fieldsetLines = (labels: string[]): string[] => {
          const fieldsets = Array.from(document.querySelectorAll('fieldset'))
          for (const fs of fieldsets) {
            const legend = fs.querySelector('legend')
            const label = legend?.textContent?.trim().toLowerCase() || ''
            if (labels.includes(label)) {
              const clone = fs.cloneNode(true) as HTMLElement
              const lg = clone.querySelector('legend')
              if (lg) lg.remove()
              return htmlToLines(clone.innerHTML)
            }
          }
          return []
        }

        const ownerNames = fieldsetLines(['names', 'name(s)', 'owner', 'owners'])
        const mailingLines = fieldsetLines(['mailing address'])

        return {
          ownerNames,
          mailingAddress: mailingLines.join('\n'),
        }
      })

      if (!data.ownerNames || data.ownerNames.length === 0) {
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

      console.log(`[${this.config.id}] Successfully extracted data`)
      console.log(`[${this.config.id}] Owner: ${data.ownerNames.join(', ')}`)
      console.log(`[${this.config.id}] Address: ${data.mailingAddress}`)

      return {
        ownerNames: data.ownerNames,
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
