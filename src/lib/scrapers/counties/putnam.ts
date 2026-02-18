/**
 * Putnam County Property Appraiser Scraper
 * URL Pattern: https://apps.putnam-fl.com/pa/property/?type=api&parcel={parcelId}
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class PutnamScraper extends BaseScraper {
  /**
   * Putnam uses direct URL with type=api and parcel parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Putnam County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the URL with parcel parameter
    const url = `${this.config.searchUrl}?type=api&parcel=${request.identifier}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)

    // Navigate and wait for content to load
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 120000,
    })

    // Wait additional time for content to fully render
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

      // Create page without request blocking
      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      // Navigate to property page
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
   * Putnam doesn't need a separate search step - navigation handles it
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Putnam property page
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

        // Find "Owner:" label and get the next line
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]

          // Look for "Owner:" label
          if (line.match(/^Owner\s*:?$/i)) {
            // Owner name is on the next line
            if (i + 1 < lines.length) {
              ownerName = lines[i + 1].trim()
            }
          }

          // Look for "Mailing Address:" label
          if (line.match(/^Mailing Address\s*:?$/i)) {
            // Address is on the next line(s) - collect until we hit another label
            const addressParts = []
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
              const nextLine = lines[j].trim()
              // Skip empty lines
              if (!nextLine) continue
              // Stop at next label (contains colon)
              if (nextLine.includes(':') && !nextLine.match(/^\d/)) break
              // Stop at known next sections
              if (nextLine.match(/^(Subdivision|Owner Id|Description|Tax Roll Year)/i)) break

              addressParts.push(nextLine)

              // If we have a line with state and ZIP, that's likely the last line
              if (nextLine.match(/[A-Z]{2}\s+\d{5}/)) break
            }

            if (addressParts.length > 0) {
              mailingAddress = addressParts.join('\n')
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
