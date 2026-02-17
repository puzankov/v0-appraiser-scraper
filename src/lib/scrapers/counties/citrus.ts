/**
 * Citrus County Property Appraiser Scraper
 * URL Pattern: https://www.citruspa.org/_Web/datalets/datalet.aspx?mode=profileall&UseSearch=no&pin={parcelId}&jur=19&LMparent=20
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class CitrusScraper extends BaseScraper {
  /**
   * Citrus County uses direct URL navigation with parcelId as query parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Citrus County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with the parcelId
    const url = `${this.config.searchUrl}?mode=profileall&UseSearch=no&pin=${encodeURIComponent(request.identifier)}&jur=19&LMparent=20`

    console.log(`[${this.config.id}] Navigating directly to: ${url}`)

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

      // Wait for content to load - wait for the Mailing Address table
      console.log(`[${this.config.id}] Waiting for property data...`)
      await page.waitForSelector('table#Mailing\\ Address', { timeout: this.config.timeout || 10000 })

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
   * Citrus County doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Citrus County property details page
   * The data is in a table with rows having labels in class "DataletSideHeading"
   * and values in class "DataletData"
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        let ownerName = ''
        const addressLines: string[] = []

        // Find the "Mailing Address" table
        const mailingTable = document.querySelector('table#Mailing\\ Address')

        if (mailingTable) {
          // Get all rows in the table
          const rows = mailingTable.querySelectorAll('tr')

          for (const row of Array.from(rows)) {
            const headingCell = row.querySelector('td.DataletSideHeading')
            const dataCell = row.querySelector('td.DataletData')

            if (headingCell && dataCell) {
              const heading = headingCell.textContent?.trim() || ''
              const value = dataCell.textContent?.trim() || ''

              // Look for the "Name" field
              if (heading === 'Name') {
                ownerName = value
              }
              // Look for "Mailing Address" or empty heading (continuation of address)
              else if (heading === 'Mailing Address' || heading === '' || heading === '\u00A0') {
                if (value && value !== '' && value !== '\u00A0') {
                  addressLines.push(value)
                }
              }
            }
          }
        }

        return {
          ownerName,
          mailingAddress: addressLines.join('\n')
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
