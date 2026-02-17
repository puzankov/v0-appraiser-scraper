/**
 * Santa Rosa County Property Appraiser Scraper
 * URL Pattern: https://parcelview.srcpa.gov/?parcel={parcelId}&baseUrl=http://srcpa.gov/
 * Note: Uses iframe-based property details page
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class SantaRosaScraper extends BaseScraper {
  /**
   * Santa Rosa uses direct URL navigation to iframe content with parcel parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Santa Rosa County navigation',
        undefined,
        this.config.id
      )
    }

    // Navigate directly to iframe URL
    const url = `https://parcelview.srcpa.gov/?parcel=${encodeURIComponent(request.identifier)}&baseUrl=http://srcpa.gov/`

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

      // Wait for property data to load
      console.log(`[${this.config.id}] Waiting for property data...`)
      await page.waitForSelector('td[data-cell="Owner"]', {
        timeout: this.config.timeout || 10000
      })

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
   * Santa Rosa doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Santa Rosa property details page
   * This is an SPA, so we need to search the rendered DOM flexibly
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
        let ownerName = ''
        let mailingAddress = ''

        // Santa Rosa uses data-cell attributes on td elements
        const ownerCell = document.querySelector('td[data-cell="Owner"]')
        const additionalCell = document.querySelector('td[data-cell="Additional"]')
        const streetCell = document.querySelector('td[data-cell="Street"]')
        const cityCell = document.querySelector('td[data-cell*="City"]')

        // Extract owner name(s)
        const ownerNames: string[] = []
        if (ownerCell) {
          const name = ownerCell.textContent?.trim() || ''
          if (name) ownerNames.push(name)
        }
        if (additionalCell) {
          const additional = additionalCell.textContent?.trim() || ''
          if (additional) ownerNames.push(additional)
        }
        ownerName = ownerNames.join(' ')

        // Extract mailing address
        const addressParts: string[] = []
        if (streetCell) {
          const street = streetCell.textContent?.trim() || ''
          if (street) addressParts.push(street)
        }
        if (cityCell) {
          const city = cityCell.textContent?.trim() || ''
          if (city) addressParts.push(city)
        }
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
