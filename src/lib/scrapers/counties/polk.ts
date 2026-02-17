/**
 * Polk County Property Appraiser Scraper
 * URL Pattern: https://www.polkflpa.gov/CamaDisplay.aspx?migratedFrom=org&OutputMode=Display&SearchType=RealEstate&Page=FindByID&ParcelID={parcelId}
 * Note: Owners are in table rows after "Owners" h4, address in table rows after "Mailing Address" h4
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class PolkScraper extends BaseScraper {
  /**
   * Polk uses direct URL navigation with ParcelID parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Polk County navigation',
        undefined,
        this.config.id
      )
    }

    const url = `${this.config.searchUrl}&ParcelID=${encodeURIComponent(request.identifier)}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)

    await page.goto(url, {
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
      await page.waitForSelector('h4', { timeout: this.config.timeout || 10000 })

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
    } catch (_error) {
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
   * Polk doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Polk property details page
   * Owners are in table rows after "Owners" h4
   * Mailing address is in table rows after "Mailing Address" h4
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        const ownerNames: string[] = []
        const addressLines: string[] = []

        // Find all h4 elements
        const allH4s = Array.from(document.querySelectorAll('h4'))

        for (const h4 of allH4s) {
          const text = h4.textContent?.trim() || ''

          // Check if this is the "Owners" header
          if (text.startsWith('Owners')) {
            // Find the next table sibling
            let nextElement = h4.nextElementSibling
            while (nextElement) {
              if (nextElement.tagName === 'TABLE') {
                // Extract owner names from tr.tr1 rows
                const rows = Array.from(nextElement.querySelectorAll('tr.tr1'))
                for (const row of rows) {
                  const cells = Array.from(row.querySelectorAll('td'))
                  if (cells.length > 0) {
                    const name = cells[0].textContent?.trim() || ''
                    if (name) {
                      ownerNames.push(name)
                    }
                  }
                }
                break
              }
              nextElement = nextElement.nextElementSibling
            }
          }

          // Check if this is the "Mailing Address" header
          if (text.startsWith('Mailing Address')) {
            // Find the next table sibling
            let nextElement = h4.nextElementSibling
            while (nextElement) {
              if (nextElement.tagName === 'TABLE') {
                // Extract address lines from all tr rows
                const rows = Array.from(nextElement.querySelectorAll('tr'))
                for (const row of rows) {
                  const cells = Array.from(row.querySelectorAll('td'))
                  // Get the last td in each row (the one with actual content)
                  if (cells.length > 0) {
                    const lastCell = cells[cells.length - 1]
                    const line = lastCell.textContent?.trim() || ''
                    if (line && !line.includes('TMPL_') && line.length > 0) {
                      addressLines.push(line)
                    }
                  }
                }
                break
              }
              nextElement = nextElement.nextElementSibling
            }
          }
        }

        return {
          ownerNames,
          addressLines
        }
      })

      // Check if we found the required data
      if (!data.ownerNames || data.ownerNames.length === 0) {
        throw createNoResultsError(this.config.id, identifier)
      }

      if (!data.addressLines || data.addressLines.length === 0) {
        throw new ScraperError(
          ErrorCode.EXTRACTION_FAILED,
          'Failed to extract mailing address',
          undefined,
          this.config.id,
          identifier
        )
      }

      // Join owner names and address lines with newlines
      const ownerName = data.ownerNames.join('\n')
      const mailingAddress = data.addressLines.join('\n')

      // Return the structured data
      return {
        ownerNames: [ownerName],
        mailingAddress: mailingAddress,
        countyId: this.config.id,
        identifier,
        identifierType,
        scrapedAt: new Date().toISOString(),
      }
    } catch (_error) {
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
