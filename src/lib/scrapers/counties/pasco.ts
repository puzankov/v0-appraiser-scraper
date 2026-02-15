/**
 * Pasco County Property Appraiser Scraper
 * URL Pattern: https://search.pascopa.com/parcel.aspx?parcel={transformedParcelId}
 *
 * ParcelId Transformation:
 * Input:  22-26-21-0030-00000-0280
 * Steps:  1. Split by '-': ['22', '26', '21', '0030', '00000', '0280']
 *         2. Rearrange first 3: ['21', '26', '22', '0030', '00000', '0280']
 *         3. Join with '-': 21-26-22-0030-00000-0280
 *         4. Remove non-numeric: 2126220030000000280
 * Output: 2126220030000000280
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class PascoScraper extends BaseScraper {
  /**
   * Transform Pasco parcelId for URL
   * Rearranges first 3 segments and removes non-numeric characters
   */
  private transformParcelId(parcelId: string): string {
    // Split by dash
    const parts = parcelId.split('-')

    if (parts.length < 3) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid Pasco parcelId format: ${parcelId}. Expected format: XX-XX-XX-XXXX-XXXXX-XXXX`,
        undefined,
        this.config.id,
        parcelId
      )
    }

    // Rearrange: take 3rd, 2nd, 1st, then rest
    const rearranged = [
      parts[2],  // 3rd part
      parts[1],  // 2nd part
      parts[0],  // 1st part
      ...parts.slice(3)  // rest as-is
    ]

    // Join and remove all non-numeric characters
    const transformed = rearranged.join('-').replace(/[^0-9]/g, '')

    console.log(`[${this.config.id}] Transformed parcelId "${parcelId}" to "${transformed}"`)

    return transformed
  }

  /**
   * Pasco uses direct URL navigation with transformed parcelId as query parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Pasco County navigation',
        undefined,
        this.config.id
      )
    }

    // Transform the parcelId
    const transformedParcelId = this.transformParcelId(request.identifier)

    // Construct the direct URL
    const url = `${this.config.searchUrl}?parcel=${transformedParcelId}`

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
      await page.waitForSelector('#lblMailingAddress', { timeout: this.config.timeout || 10000 })

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
   * Pasco doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Pasco property details page
   * Owner and mailing address are in the same element, separated by <br/> tags
   * First line is owner, remaining lines are mailing address
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
        const htmlToText = (html: string): string[] => {
          // Replace <br> tags with a unique marker
          const withMarkers = html.replace(/<br\s*\/?>/gi, '|||NEWLINE|||')

          // Create a temporary element to decode HTML entities
          const temp = document.createElement('div')
          temp.innerHTML = withMarkers

          // Get text content (this decodes HTML entities like &amp;)
          const decoded = temp.textContent || ''

          // Split by marker and clean up
          return decoded
            .split('|||NEWLINE|||')
            .map(line => line.trim())
            .filter(line => line.length > 0)
        }

        let ownerName = ''
        let mailingAddress = ''

        // Find the mailing address span
        const mailingElement = document.querySelector('#lblMailingAddress')

        if (mailingElement) {
          const lines = htmlToText(mailingElement.innerHTML)

          // First line is owner name
          if (lines.length > 0) {
            ownerName = lines[0]
          }

          // Remaining lines are mailing address
          if (lines.length > 1) {
            mailingAddress = lines.slice(1).join('\n')
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
