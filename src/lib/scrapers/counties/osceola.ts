/**
 * Osceola County Property Appraiser Scraper
 * URL Pattern: https://search.property-appraiser.org/Search?PIN={parcelId}
 * Note: Page redirects to MainSearch after initial load
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class OsceolaScraper extends BaseScraper {
  /**
   * Osceola uses PIN parameter which triggers redirect to MainSearch
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Osceola County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the URL with PIN parameter
    const url = `${this.config.searchUrl}?PIN=${request.identifier}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)

    // Navigate and wait for redirects to complete
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 120000,
    })

    console.log(`[${this.config.id}] Final URL: ${page.url()}`)

    // Wait additional time for content to fully render after redirects
    console.log(`[${this.config.id}] Waiting for content to fully load...`)
    await new Promise(resolve => setTimeout(resolve, 10000))
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

      // Create page without request blocking (Osceola needs all resources)
      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      // Navigate to property page (handles redirects)
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
   * Osceola doesn't need a separate search step - navigation handles it
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Osceola property page
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data by parsing the page text
      const data = await page.evaluate(() => {
        const bodyText = document.body.innerText

        let ownerName = ''
        let mailingAddress = ''

        // Split into lines for parsing
        const lines = bodyText.split('\n').map(line => line.trim()).filter(line => line.length > 0)

        // Find "Owner(s):" label and get the next non-empty line
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]

          // Look for "Owner(s):" or "Owner:" label
          if (line.match(/^Owner\(s\)\s*:?$/i) || line.match(/^Owner\s*:?$/i)) {
            // Owner name is in the next line(s)
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
              const nextLine = lines[j].trim()
              // Skip empty lines and stop at next label
              if (!nextLine) continue
              if (nextLine.includes(':')) break
              if (nextLine.match(/^(Mailing|Property|Primary|Tax)/i)) break

              ownerName = nextLine
              break
            }
          }

          // Look for "Mailing Address:" label - address might be on same line
          if (line.match(/^Mailing Address\s*:?\s*/i)) {
            // Check if address is on the same line
            const sameLineMatch = line.match(/^Mailing Address\s*:?\s*(.+)/i)
            if (sameLineMatch && sameLineMatch[1]) {
              // Address is on the same line - remove "Request change" text
              let addr = sameLineMatch[1].trim()
              addr = addr.replace(/\s*Request change.*$/i, '')
              if (addr.length > 10) {
                mailingAddress = addr
              }
            }

            // If not found on same line, look on next line(s)
            if (!mailingAddress) {
              const addressParts = []
              for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                const nextLine = lines[j].trim()
                if (!nextLine) continue
                if (nextLine.match(/^(Property Address|Primary Use|Tax District|Request change)/i)) break
                if (nextLine.includes(':') && !nextLine.match(/^\d/)) break

                addressParts.push(nextLine)
                if (nextLine.match(/[A-Z]{2}\s+\d{5}/)) break
              }

              if (addressParts.length > 0) {
                mailingAddress = addressParts.join(' ')
              }
            }
          }
        }

        return {
          ownerName: ownerName.trim(),
          mailingAddress: mailingAddress.trim()
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

      console.log(`[${this.config.id}] Successfully extracted data`)
      console.log(`[${this.config.id}] Owner: ${data.ownerName}`)
      console.log(`[${this.config.id}] Address: ${data.mailingAddress}`)

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
