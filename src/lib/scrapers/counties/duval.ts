/**
 * Duval County Property Appraiser Scraper
 * URL Pattern: https://paopropertysearch.coj.net/Basic/Detail.aspx?RE={parcelId}
 * Note: ParcelId format transformation required - input format "035697-0000" becomes "0356970000" in URL
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class DuvalScraper extends BaseScraper {
  /**
   * Duval County uses direct URL navigation with parcelId as query parameter
   * ParcelId needs to be transformed: "035697-0000" -> "0356970000" (remove hyphen)
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Duval County navigation',
        undefined,
        this.config.id
      )
    }

    // Transform parcelId: remove hyphen for URL
    const transformedParcelId = request.identifier.replace(/-/g, '')

    // Construct the direct URL with the transformed parcelId
    const url = `${this.config.searchUrl}?RE=${encodeURIComponent(transformedParcelId)}`

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

      // Navigate directly to property page (no search needed)
      await this.navigateToSearch(page, request)

      // Wait for content to load - wait for owner name element
      console.log(`[${this.config.id}] Waiting for property data...`)
      await page.waitForSelector('span[id*="lblOwnerName"]', { timeout: this.config.timeout || 10000 })

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
   * Duval County doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Duval County property details page
   * Owner is in span with id containing "lblOwnerName"
   * Mailing address is in spans with ids containing "lblMailingAddressLine1" and "lblMailingAddressLine3"
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
        let mailingAddress = ''

        // Find the owner name span
        const ownerElement = document.querySelector('span[id*="lblOwnerName"]')
        if (ownerElement) {
          ownerName = ownerElement.textContent?.trim() || ''
        }

        // Find the mailing address line 1
        const addressLine1Element = document.querySelector('span[id*="lblMailingAddressLine1"]')
        const addressLine1 = addressLine1Element?.textContent?.trim() || ''

        // Find the mailing address line 3 (line 2 is typically empty)
        const addressLine3Element = document.querySelector('span[id*="lblMailingAddressLine3"]')
        const addressLine3 = addressLine3Element?.textContent?.trim() || ''

        // Combine address lines with newline
        const addressParts = [addressLine1, addressLine3].filter(line => line.length > 0)
        mailingAddress = addressParts.join('\n')

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
