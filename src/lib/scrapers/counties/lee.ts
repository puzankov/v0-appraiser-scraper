/**
 * Lee County Property Appraiser Scraper
 * URL Pattern: http://www.leepa.org/Scripts/PropertyQuery/PropertyQuery.aspx?STRAP={parcelId}
 * Note: Owner and address are in the same div.textPanel, separated by <br/> tags
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class LeeScraper extends BaseScraper {
  /**
   * Lee uses direct URL navigation with STRAP parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Lee County navigation',
        undefined,
        this.config.id
      )
    }

    const url = `${this.config.searchUrl}?STRAP=${encodeURIComponent(request.identifier)}`

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
      await page.waitForSelector('.textPanel', { timeout: this.config.timeout || 10000 })

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
   * Lee doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Lee property details page
   * Owner and address are in the same div.textPanel under "Owner Of Record"
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

        // Find the textPanel div that contains owner information
        // It's under the "Owner Of Record" section in divDisplayParcelOwner
        const ownerDiv = document.querySelector('#divDisplayParcelOwner')
        if (ownerDiv) {
          const textPanels = Array.from(ownerDiv.querySelectorAll('.textPanel'))

          // The first textPanel contains owner and address
          if (textPanels.length > 0) {
            const firstPanel = textPanels[0]
            const fullText = htmlToText(firstPanel.innerHTML)
            const lines = fullText.split('\n')

            // Separate owner names from address
            const ownerParts: string[] = []
            const addressParts: string[] = []

            for (const line of lines) {
              // If line starts with a number, it's the beginning of the address
              if (/^\d+/.test(line)) {
                // This and all remaining lines are address
                addressParts.push(line)
                // Get remaining lines
                const currentIndex = lines.indexOf(line)
                for (let i = currentIndex + 1; i < lines.length; i++) {
                  if (lines[i]) {
                    addressParts.push(lines[i])
                  }
                }
                break
              } else if (line) {
                // This is part of owner name
                ownerParts.push(line)
              }
            }

            ownerName = ownerParts.join('\n')
            mailingAddress = addressParts.join('\n')
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
