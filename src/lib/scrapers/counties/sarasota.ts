/**
 * Sarasota County Property Appraiser Scraper
 * URL Pattern: https://www.sc-pa.com/propertysearch/parcel/{parcelId}
 * Note: Owner names are in separate <li> elements followed by address
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class SarasotaScraper extends BaseScraper {
  /**
   * Sarasota uses direct URL navigation with parcelId in path
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Sarasota County navigation',
        undefined,
        this.config.id
      )
    }

    const url = `${this.config.searchUrl}/${encodeURIComponent(request.identifier)}`

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
      await page.waitForSelector('ul.resultl', { timeout: this.config.timeout || 10000 })

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
   * Sarasota doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Sarasota property details page
   * Owner names are in separate <li> elements after "Ownership:" label
   * Mailing address is in the <li> following the owner names
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
        let mailingAddress = ''

        // Find the ul.resultl element
        const resultList = document.querySelector('ul.resultl.spaced')
        if (resultList) {
          const listItems = Array.from(resultList.querySelectorAll('li'))

          let inOwnership = false

          for (const li of listItems) {
            const text = li.textContent?.trim() || ''
            const classes = li.className || ''

            // Check if this is the "Ownership:" header
            if (classes.includes('med') && classes.includes('bold') && text === 'Ownership:') {
              inOwnership = true
              continue
            }

            // Check if we've reached the next section
            if (classes.includes('med') && classes.includes('bold') && inOwnership) {
              // We've reached another section, stop
              break
            }

            // Check if this is the "Situs Address:" label
            if (text === 'Situs Address:') {
              break
            }

            // Skip the "Change mailing address" link
            if (classes.includes('app-links')) {
              continue
            }

            // If we're in the ownership section
            if (inOwnership && text) {
              // Check if this looks like an address (contains comma or numbers)
              // The address comes after all the owner names
              if (text.includes(',') || /\d{5}/.test(text)) {
                mailingAddress = text
                break
              } else {
                // This is an owner name
                ownerNames.push(text)
              }
            }
          }
        }

        return {
          ownerNames,
          mailingAddress
        }
      })

      // Check if we found the required data
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

      // Return the structured data
      return {
        ownerNames: data.ownerNames,
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
