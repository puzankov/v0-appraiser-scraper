/**
 * Volusia County Property Appraiser Scraper
 * URL Pattern: https://vcpa.vcgov.org/parcel/summary/?altkey={parcelId}
 * Note: Requires clicking "Agree" button on disclaimer before data loads
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class VolusiaScraper extends BaseScraper {
  /**
   * Volusia uses direct URL navigation with altkey parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Volusia County navigation',
        undefined,
        this.config.id
      )
    }

    const url = `${this.config.searchUrl}?altkey=${encodeURIComponent(request.identifier)}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: this.config.timeout || 30000,
    })
  }

  /**
   * Override the main scrape method to handle disclaimer
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

      // Navigate to property page
      await this.navigateToSearch(page, request)

      // Wait for and click the disclaimer Agree button
      console.log(`[${this.config.id}] Waiting for disclaimer...`)
      await page.waitForSelector('#acceptDataDisclaimer', {
        timeout: this.config.timeout || 10000
      })

      console.log(`[${this.config.id}] Clicking Agree button...`)
      await page.click('#acceptDataDisclaimer')

      // Wait for owner data to appear
      console.log(`[${this.config.id}] Waiting for property data...`)
      await page.waitForFunction(
        () => {
          const text = document.body.innerText
          return text.includes('Owner(s):')
        },
        { timeout: 10000 }
      )

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
   * Volusia doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Volusia property details page
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

        // Find the "Owner(s):" label and get the next div sibling
        const allStrongs = Array.from(document.querySelectorAll('strong'))

        for (const strong of allStrongs) {
          const text = strong.textContent?.trim() || ''

          if (text === 'Owner(s):') {
            // Get parent div
            const parentDiv = strong.parentElement
            if (parentDiv) {
              // Get next sibling div (contains owner data)
              const nextDiv = parentDiv.nextElementSibling
              if (nextDiv) {
                ownerName = htmlToText(nextDiv.innerHTML)
              }
            }
          }

          if (text === 'Mailing Address On File:') {
            // Get parent div
            const parentDiv = strong.parentElement
            if (parentDiv) {
              // Get next sibling div (contains address data)
              const nextDiv = parentDiv.nextElementSibling
              if (nextDiv) {
                // Extract only the address lines, not the "Update Mailing Address" link
                const clone = nextDiv.cloneNode(true) as Element
                // Remove the <a> tag with "Update Mailing Address"
                const link = clone.querySelector('a')
                if (link) {
                  link.remove()
                }
                mailingAddress = htmlToText(clone.innerHTML)
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
