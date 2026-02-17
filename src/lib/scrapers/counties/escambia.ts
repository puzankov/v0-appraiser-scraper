/**
 * Escambia County Property Appraiser Scraper
 * URL Pattern: https://www.escpa.org/cama/Detail_a.aspx?s={parcelId}
 * Note: ParcelId is used directly in URL as 's' parameter
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class EscambiaScraper extends BaseScraper {
  /**
   * Escambia uses direct URL navigation with parcelId as query parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Escambia County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with parcelId as 's' parameter
    const url = `${this.config.searchUrl}?s=${encodeURIComponent(request.identifier)}`

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
   * Escambia doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Escambia property details page
   * Data is in a table with label cells and value cells
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

        // Find all table cells
        const allCells = Array.from(document.querySelectorAll('td'))

        for (let i = 0; i < allCells.length; i++) {
          const cell = allCells[i]
          const text = cell.textContent?.trim() || ''

          // Look for "Owners:" label
          if (text === 'Owners:') {
            // The next TD cell should contain the owner name in a span
            const nextCell = allCells[i + 1]
            if (nextCell) {
              const span = nextCell.querySelector('span')
              if (span) {
                ownerName = htmlToText(span.innerHTML)
              }
            }
          }

          // Look for "Mail:" label
          if (text === 'Mail:') {
            // The next TD cell should contain the mailing address in a span
            const nextCell = allCells[i + 1]
            if (nextCell) {
              const span = nextCell.querySelector('span')
              if (span) {
                mailingAddress = htmlToText(span.innerHTML)
              }
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
