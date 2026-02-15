/**
 * Miami-Dade County Property Appraiser Scraper
 * URL Pattern: https://apps.miamidadepa.gov/PropertySearch/#/?folio={folio}
 * Note: This is an Angular SPA - requires waiting for dynamic content to load
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class MiamiDadeScraper extends BaseScraper {
  /**
   * Miami-Dade uses direct URL navigation with folio as URL parameter
   * ParcelID format: 30-3053-106-0510 -> needs to be converted to 3030531060510 (remove non-numeric)
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Miami-Dade County navigation',
        undefined,
        this.config.id
      )
    }

    // Strip all non-numeric characters from parcelId to get folio
    const folio = request.identifier.replace(/[^0-9]/g, '')

    if (!folio) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid parcel ID format - no numeric characters found',
        undefined,
        this.config.id,
        request.identifier
      )
    }

    // Construct the direct URL with the folio
    const url = `${this.config.searchUrl}#/?folio=${folio}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)
    console.log(`[${this.config.id}] Transformed parcelId "${request.identifier}" to folio "${folio}"`)

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

      // Wait for Angular app to load and render property data
      console.log(`[${this.config.id}] Waiting for Angular app to render...`)

      // Wait for content that indicates the property data has loaded
      // Try multiple possible selectors since we don't know the exact structure yet
      try {
        await page.waitForFunction(
          () => {
            // Look for any content that would indicate property data loaded
            const bodyText = document.body.innerText
            return bodyText.length > 1000 &&
                   (bodyText.includes('Owner') || bodyText.includes('Mailing') || bodyText.includes('Property'))
          },
          { timeout: this.config.timeout || 15000 }
        )
      } catch (error) {
        // If the generic wait fails, try waiting for a specific amount of time
        console.log(`[${this.config.id}] Generic wait failed, waiting 5 seconds for content...`)
        await page.waitForTimeout(5000)
      }

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
   * Miami-Dade doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Miami-Dade property details page
   * This is an Angular SPA, so we need to search the rendered DOM
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

        // Miami-Dade specific structure:
        // Labels are in <strong> tags, values are in sibling <div> elements

        // Find all strong tags that might contain labels
        const strongElements = Array.from(document.querySelectorAll('strong'))

        for (const strong of strongElements) {
          const labelText = strong.textContent?.trim() || ''
          const lowerLabel = labelText.toLowerCase()

          // Look for Owner label
          if (lowerLabel === 'owner' && !ownerName) {
            // Find the parent td
            const td = strong.closest('td')
            if (td) {
              // Find the div with class ms-2 that contains the value
              const valueDiv = td.querySelector('div.ms-2')
              if (valueDiv) {
                ownerName = valueDiv.textContent?.trim() || ''
              }
            }
          }

          // Look for Mailing Address label
          if (lowerLabel === 'mailing address' && !mailingAddress) {
            // Find the parent td
            const td = strong.closest('td')
            if (td) {
              // Find the div with class ms-2 that contains the value
              const valueDiv = td.querySelector('div.ms-2')
              if (valueDiv) {
                // Get the HTML content and replace <br> with newlines
                const html = valueDiv.innerHTML
                mailingAddress = html
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<[^>]+>/g, '') // Remove all other HTML tags
                  .split('\n')
                  .map(line => line.trim())
                  .filter(line => line.length > 0)
                  .join('\n')
              }
            }
          }
        }

        // Alternative: Look for td with class pi_mailing_address
        if (!mailingAddress) {
          const mailingTd = document.querySelector('td.pi_mailing_address')
          if (mailingTd) {
            const valueDiv = mailingTd.querySelector('div.ms-2')
            if (valueDiv) {
              const html = valueDiv.innerHTML
              mailingAddress = html
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n')
            }
          }
        }

        return {
          ownerName,
          mailingAddress,
          // Return page HTML for debugging if needed
          debugHtml: !ownerName || !mailingAddress ? document.body.innerHTML.substring(0, 5000) : ''
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

      // Clean up the address - normalize newlines
      const cleanedAddress = data.mailingAddress
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .trim()

      // Return the structured data
      return {
        ownerNames: [data.ownerName],
        mailingAddress: cleanedAddress,
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
