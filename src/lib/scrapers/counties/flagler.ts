/**
 * Flagler County Property Appraiser Scraper
 * URL Pattern: https://qpublic.schneidercorp.com/Application.aspx?AppID=598&LayerID=9801&PageTypeID=4&PageID=4330&KeyValue={parcelId}
 * Note: Uses qpublic.schneidercorp.com system similar to Clay County
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class FlaglerScraper extends BaseScraper {
  /**
   * Flagler uses direct URL navigation with KeyValue parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Flagler County navigation',
        undefined,
        this.config.id
      )
    }

    const url = `${this.config.searchUrl}&KeyValue=${encodeURIComponent(request.identifier)}`

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
      await page.waitForSelector('.four-column-blocks', { timeout: this.config.timeout || 10000 })

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
   * Flagler doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Flagler property details page
   * Similar structure to Clay County - uses qpublic.schneidercorp.com
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
          // Replace <br> tags (case insensitive) with a unique marker
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

        // Find elements (span or a) with IDs containing "sprPrimaryOwnerName"
        // The owner name can be in either a <span> or an <a> tag
        const allElements = Array.from(document.querySelectorAll('[id*="sprPrimaryOwnerName"]'))

        for (const element of allElements) {
          const elementId = element.id || ''

          if (elementId.includes('sprPrimaryOwnerName')) {
            // This is the primary owner name
            const nameText = element.textContent?.trim() || ''
            if (nameText) {
              ownerName = nameText
            }

            // Look for the address span (next span with sprPrimaryOwnerAddress)
            const addressSpans = Array.from(document.querySelectorAll('span[id*="sprPrimaryOwnerAddress"]'))
            if (addressSpans.length > 0) {
              const addressSpan = addressSpans[0]
              const fullText = htmlToText(addressSpan.innerHTML)
              const lines = fullText.split('\n')

              // Separate owner continuation from address
              const ownerParts: string[] = [ownerName]
              const addressParts: string[] = []

              for (const line of lines) {
                // If line starts with a number or contains street/city keywords, it's part of address
                if (/^\d+/.test(line) || /^[A-Z][a-z]+ [A-Z]{2} \d{5}/.test(line) || addressParts.length > 0) {
                  addressParts.push(line)
                } else {
                  // This is still part of owner info (like "& Paul Lawrence Marcinkoski Jtwros")
                  ownerParts.push(line)
                }
              }

              ownerName = ownerParts.join('\n')
              mailingAddress = addressParts.join('\n')
            }
            break
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
