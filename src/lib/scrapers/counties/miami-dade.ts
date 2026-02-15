/**
 * Miami-Dade County Property Appraiser Scraper
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class MiamiDadeScraper extends BaseScraper {
  /**
   * Perform search on Miami-Dade property search page
   */
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    const { identifier, identifierType } = request

    // Wait for search input to be available
    const searchInput = this.config.selectors.searchInput
    if (!searchInput) {
      throw new ScraperError(
        ErrorCode.SEARCH_FAILED,
        'Search input selector not configured',
        undefined,
        this.config.id
      )
    }

    try {
      // Type the identifier into the search field
      await this.typeIntoField(page, searchInput, identifier)

      // Click the search button
      const searchButton = this.config.selectors.searchButton
      if (searchButton) {
        await this.clickButton(page, searchButton)
      } else {
        // If no button, try submitting the form
        await page.keyboard.press('Enter')
      }

      // Wait a bit for the page to load
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
   * Extract property data from Miami-Dade results page
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Check if there are no results
      const noResultsIndicator = this.config.selectors.noResultsIndicator
      if (noResultsIndicator && await this.elementExists(page, noResultsIndicator)) {
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
   * Extract owner names from page
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

    // Try to extract as array first
    if (Array.isArray(ownerNameSelector)) {
      const names: string[] = []
      for (const selector of ownerNameSelector) {
        const text = await this.extractText(page, selector)
        if (text) names.push(text)
      }
      return names
    }

    // Check if there are multiple owner name elements
    const multipleSelector = this.config.selectors.ownerNameMultiple
    if (multipleSelector) {
      return await this.extractTextMultiple(page, multipleSelector)
    }

    // Extract single owner name
    const ownerName = await this.extractText(page, ownerNameSelector)
    if (!ownerName) {
      return []
    }

    // Check if the name contains multiple owners (e.g., "JOHN DOE & JANE DOE")
    // Split by common delimiters
    if (ownerName.includes(' & ') || ownerName.includes(' AND ')) {
      return ownerName.split(/\s+&\s+|\s+AND\s+/i).map(n => n.trim())
    }

    return [ownerName]
  }

  /**
   * Extract mailing address from page
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

    // Try to extract as structured address
    if (this.config.selectors.addressLine1) {
      const line1 = await this.extractText(page, this.config.selectors.addressLine1)
      const city = await this.extractText(page, this.config.selectors.city || '')
      const state = await this.extractText(page, this.config.selectors.state || '')
      const zipCode = await this.extractText(page, this.config.selectors.zipCode || '')

      const parts = [line1, city, state, zipCode].filter(Boolean)
      if (parts.length > 0) {
        return parts.join(', ')
      }
    }

    // Extract as single field
    if (Array.isArray(addressSelector)) {
      const addressParts: string[] = []
      for (const selector of addressSelector) {
        const text = await this.extractText(page, selector)
        if (text) addressParts.push(text)
      }
      return addressParts.join(', ')
    }

    const address = await this.extractText(page, addressSelector)
    if (!address) {
      throw new ScraperError(
        ErrorCode.EXTRACTION_FAILED,
        'Failed to extract mailing address',
        undefined,
        this.config.id
      )
    }

    return address
  }
}
