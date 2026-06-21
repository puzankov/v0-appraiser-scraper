/**
 * St. Johns County Property Appraiser Scraper
 * URL Pattern: https://qpublic.schneidercorp.com/Application.aspx?AppID=960&LayerID=21179&PageTypeID=4&PageID=9059&Q=...&KeyValue={parcelId}
 * Note: Uses the qpublic.schneidercorp.com system, same as Flagler/Clay County.
 *       searchUrl in the config already carries the full query string; we append &KeyValue.
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class StJohnsScraper extends BaseScraper {
  /**
   * St. Johns uses direct URL navigation with KeyValue parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for St. Johns County navigation',
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
      await page.waitForSelector('[id$="_lblOwnerAddress"]', { timeout: this.config.timeout || 10000 })

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
   * St. Johns doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from St. Johns property details page.
   * St. Johns uses the newer qpublic template: an rptOwner repeater where each
   * owner block exposes the name in [...sprOwnerName1...lblSearch] (sprOwnerName2 is
   * the ownership percentage, not a name) and the mailing address in [...lblOwnerAddress].
   * The same mailing address is repeated per owner, so addresses are de-duplicated.
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        // Convert address innerHTML (with <br>) into newline-joined, decoded text
        const htmlToText = (html: string): string => {
          const withMarkers = html.replace(/<br\s*\/?>/gi, '|||NEWLINE|||')
          const temp = document.createElement('div')
          temp.innerHTML = withMarkers
          const decoded = temp.textContent || ''
          return decoded
            .split('|||NEWLINE|||')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
        }

        const ownerNames: string[] = []
        const addresses: string[] = []

        // Each owner block is anchored by its mailing-address element
        const addressEls = Array.from(document.querySelectorAll('[id$="_lblOwnerAddress"]'))

        for (const addrEl of addressEls) {
          const prefix = addrEl.id.replace(/_lblOwnerAddress$/, '')

          // Owner name lives in the suppressed search label under sprOwnerName1
          const nameEl = document.querySelector(`[id^="${prefix}_sprOwnerName1"][id$="lblSearch"]`)
          const ownerName = nameEl?.textContent?.trim() || ''
          if (ownerName) {
            ownerNames.push(ownerName)
          }

          const address = htmlToText(addrEl.innerHTML)
          if (address) {
            addresses.push(address)
          }
        }

        // Merge owners; de-duplicate the (repeated) mailing address
        const mergedOwners = ownerNames.join('\n')
        const mergedAddress = [...new Set(addresses)].join('\n')

        return {
          ownerName: mergedOwners,
          mailingAddress: mergedAddress,
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
