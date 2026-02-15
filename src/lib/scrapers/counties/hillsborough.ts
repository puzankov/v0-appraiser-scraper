/**
 * Hillsborough County Property Appraiser Scraper
 * URL Pattern: https://gis.hcpafl.org/PropertySearch/#/parcel/basic/{parcelId}
 * Note: This is a JavaScript SPA - requires waiting for dynamic content to load
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class HillsboroughScraper extends BaseScraper {
  /**
   * Hillsborough uses direct URL navigation with parcelId in URL hash
   * ParcelId is used directly without transformation
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Hillsborough County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with the parcelId in hash
    const url = `${this.config.searchUrl}#/parcel/basic/${encodeURIComponent(request.identifier)}`

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

      // Wait for JavaScript SPA to load and render property data
      console.log(`[${this.config.id}] Waiting for SPA to render...`)

      // Wait for the owner name to be populated
      try {
        await page.waitForFunction(
          () => {
            const ownerElement = document.querySelector('h4[data-bind*="publicOwner"]')
            return ownerElement && ownerElement.textContent && ownerElement.textContent.trim().length > 0
          },
          { timeout: this.config.timeout || 15000 }
        )
      } catch (error) {
        console.log(`[${this.config.id}] Wait for owner failed, trying alternative wait...`)
        // Fallback: wait for mailing address section
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
   * Hillsborough doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Hillsborough property details page
   * This is a JavaScript SPA using Knockout.js data bindings
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        // Helper function to preserve newlines from HTML
        const htmlToText = (element: Element): string => {
          const html = element.innerHTML
          return html
            .replace(/<br\s*\/?>/gi, '\n')  // Replace <br> with newlines
            .replace(/<[^>]+>/g, '')         // Remove all other HTML tags
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
        }

        let ownerName = ''
        let mailingAddress = ''

        // Find the h4 element with publicOwner data binding
        const ownerElement = document.querySelector('h4[data-bind*="publicOwner"]')
        if (ownerElement) {
          ownerName = htmlToText(ownerElement)
        }

        // Find the p element with mailingAddress.publicAddress data binding
        const addressElement = document.querySelector('p.multiline[data-bind*="mailingAddress"]')
        if (addressElement) {
          mailingAddress = htmlToText(addressElement)
        }

        // Alternative: look for any h5 with "Mailing Address" and get the next p
        if (!mailingAddress) {
          const h5Elements = Array.from(document.querySelectorAll('h5'))
          for (const h5 of h5Elements) {
            if (h5.textContent?.trim() === 'Mailing Address') {
              const nextP = h5.nextElementSibling
              if (nextP && nextP.tagName === 'P') {
                mailingAddress = htmlToText(nextP)
                break
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
