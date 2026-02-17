/**
 * Brevard County Property Appraiser Scraper
 * URL Pattern: https://www.bcpao.us/PropertySearch/#/parcel/{parcelId}
 * Note: This is a JavaScript SPA using Knockout.js - requires waiting for dynamic content to load
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class BrevardScraper extends BaseScraper {
  /**
   * Brevard uses direct URL navigation with parcelId in URL hash
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Brevard County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with the parcelId in hash
    const url = `${this.config.searchUrl}#/parcel/${encodeURIComponent(request.identifier)}`

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
            const ownerElement = document.querySelector('[data-bind="text: publicOwners"]')
            return ownerElement && ownerElement.textContent && ownerElement.textContent.trim().length > 0
          },
          { timeout: this.config.timeout || 15000 }
        )
      } catch (_error) {
        console.log(`[${this.config.id}] Wait for owner failed, trying alternative wait...`)
        // Fallback: wait for mailing address section
        await new Promise(resolve => setTimeout(resolve, 5000))
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
   * Brevard doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Brevard property details page
   * This is a JavaScript SPA using Knockout.js data bindings
   * Owner is in div[data-bind="text: publicOwners"]
   * Mailing address is in div[data-bind="text: mailingAddress.formatted"]
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        // Helper function to preserve newlines from HTML and decode entities
        let ownerName = ''
        let mailingAddress = ''

        // Find the div element with publicOwners data binding
        const ownerElement = document.querySelector('[data-bind="text: publicOwners"]')
        if (ownerElement) {
          // Get text content directly (no HTML to parse for this element)
          ownerName = ownerElement.textContent?.trim() || ''
        }

        // Find the div element with mailingAddress.formatted data binding
        const addressElement = document.querySelector('[data-bind="text: mailingAddress.formatted"]')
        if (addressElement) {
          // Get text content directly (no HTML to parse for this element)
          mailingAddress = addressElement.textContent?.trim() || ''
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
