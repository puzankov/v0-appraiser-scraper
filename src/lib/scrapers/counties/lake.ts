/**
 * Lake County Property Appraiser Scraper
 * URL Pattern: https://lakecopropappr.com/property-details.aspx?ParcelID={parcelId}
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class LakeScraper extends BaseScraper {
  /**
   * Lake County uses direct URL navigation with parcelId as query parameter
   * Override the navigate method to go directly to the property details page
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Lake County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with the parcelId
    const url = `${this.config.searchUrl}?ParcelID=${encodeURIComponent(request.identifier)}`

    console.log(`[${this.config.id}] Navigating directly to: ${url}`)

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: this.config.timeout || 30000,
    })
  }

  /**
   * For Lake County, we override the main scrape method to pass request to navigation
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

      // Navigate directly to property page (no search needed)
      await this.navigateToSearch(page, request)

      // Wait for content to load
      console.log(`[${this.config.id}] Waiting for property data...`)
      await page.waitForSelector('table.property_head', { timeout: this.config.timeout || 10000 })

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
   * Lake County doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Lake County property details page
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        // Find all table rows in property_head table
        const rows = Array.from(document.querySelectorAll('table.property_head tr'))

        let ownerName = ''
        let mailingAddress = ''

        // Search through rows to find Name and Mailing Address
        for (const row of rows) {
          const cells = row.querySelectorAll('td')

          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            const text = cell.textContent?.trim() || ''

            // Check if this is a label cell
            if (cell.classList.contains('property_field')) {
              // Check for Name (must be exactly "Name:" to avoid "Property Name:")
              if (text === 'Name:') {
                const valueCell = cells[i + 1]
                if (valueCell && valueCell.classList.contains('property_item')) {
                  ownerName = valueCell.textContent?.trim() || ''
                }
              }

              // Check for Mailing Address
              if (text.includes('Mailing Address:')) {
                const valueCell = cells[i + 1]
                if (valueCell && valueCell.classList.contains('property_item')) {
                  // Clone the cell to manipulate it
                  const clone = valueCell.cloneNode(true) as HTMLElement

                  // Remove any links (like "Update Mailing Address")
                  const links = clone.querySelectorAll('a')
                  links.forEach(link => link.remove())

                  // Remove any span elements (like smalltext)
                  const spans = clone.querySelectorAll('span')
                  spans.forEach(span => span.remove())

                  // Get the HTML content and process it
                  const html = clone.innerHTML
                  // Replace <br> tags with newlines, then clean up
                  mailingAddress = html
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<[^>]+>/g, '') // Remove all other HTML tags
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && !line.includes('Update Mailing Address'))
                    .join('\n')
                }
              }
            }
          }
        }

        return { ownerName, mailingAddress }
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
