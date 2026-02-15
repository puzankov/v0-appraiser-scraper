/**
 * Broward County Property Appraiser Scraper
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class BrowardScraper extends BaseScraper {
  /**
   * Perform search on Broward property search page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    const { identifier, identifierType } = request

    try {
      // Broward may have a search type dropdown
      const searchTypeSelect = this.config.selectors.searchTypeSelect
      if (searchTypeSelect) {
        await page.waitForSelector(searchTypeSelect, { timeout: 5000 })

        // Select appropriate search type based on identifier type
        let searchTypeValue = 'parcelId'
        if (identifierType === 'folio') {
          searchTypeValue = 'folio'
        } else if (identifierType === 'address') {
          searchTypeValue = 'address'
        }

        await page.select(searchTypeSelect, searchTypeValue)
        await page.waitForTimeout(500)
      }

      // Type the identifier into the search field
      const searchInput = this.config.selectors.searchInput
      if (!searchInput) {
        throw new ScraperError(
          ErrorCode.SEARCH_FAILED,
          'Search input selector not configured',
          undefined,
          this.config.id
        )
      }

      await this.typeIntoField(page, searchInput, identifier)

      // Click the search button
      const searchButton = this.config.selectors.searchButton
      if (searchButton) {
        await this.clickButton(page, searchButton)
      } else {
        await page.keyboard.press('Enter')
      }

      // Wait for results to load
      await page.waitForTimeout(2000)

    } catch (error) {
      throw new ScraperError(
        ErrorCode.SEARCH_FAILED,
        `Failed to perform search for ${identifier}`,
        error,
        this.config.id,
        identifier
      )
    }
  }

  /**
   * Extract property data from Broward results page
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Check if there are no results
      const noResultsText = await page.evaluate(() => document.body.textContent)
      if (noResultsText?.includes('No records found') || noResultsText?.includes('No results')) {
        throw createNoResultsError(this.config.id, identifier)
      }

      // Extract owner name(s)
      const ownerNames = await this.extractOwnerNames(page)
      if (ownerNames.length === 0) {
        throw createNoResultsError(this.config.id, identifier)
      }

      // Extract mailing address
      const mailingAddress = await this.extractMailingAddress(page)

      return {
        ownerNames,
        mailingAddress,
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

  /**
   * Extract owner names from Broward results (often in a table)
   */
  private async extractOwnerNames(page: Page): Promise<string[]> {
    const ownerNameSelector = this.config.selectors.ownerName

    if (!ownerNameSelector) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Owner name selector not configured',
        undefined,
        this.config.id
      )
    }

    // Try extracting from table cells
    const names = await this.extractTextMultiple(page, ownerNameSelector)
    if (names.length > 0) {
      return names
    }

    // Fallback: try single extraction
    const ownerName = await this.extractText(page, ownerNameSelector)
    if (!ownerName) {
      return []
    }

    // Split multiple owners if they're in one field
    if (ownerName.includes(' & ') || ownerName.includes(' AND ')) {
      return ownerName.split(/\s+&\s+|\s+AND\s+/i).map(n => n.trim())
    }

    return [ownerName]
  }

  /**
   * Extract mailing address from Broward results
   */
  private async extractMailingAddress(page: Page): Promise<string> {
    const addressSelector = this.config.selectors.mailingAddress

    if (!addressSelector) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Mailing address selector not configured',
        undefined,
        this.config.id
      )
    }

    // Try table cells for address
    if (typeof addressSelector === 'string') {
      const addresses = await this.extractTextMultiple(page, addressSelector)
      if (addresses.length > 0) {
        // If multiple address parts in cells, join them
        return addresses.join(', ')
      }

      // Try single extraction
      const address = await this.extractText(page, addressSelector)
      if (address) {
        return address
      }
    }

    throw new ScraperError(
      ErrorCode.EXTRACTION_FAILED,
      'Failed to extract mailing address',
      undefined,
      this.config.id
    )
  }
}
