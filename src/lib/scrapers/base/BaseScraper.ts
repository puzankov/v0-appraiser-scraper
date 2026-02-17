/**
 * Base scraper class using Template Method pattern
 * All county-specific scrapers extend this class
 */

import { Browser, Page } from 'puppeteer-core'
import { ScrapeRequest, ScrapeResult, PropertyOwnerData, CountyConfig } from '@/types/scraper'
import { createBrowser, createPage, navigateToUrl, waitForSelector, closeBrowser } from '../utils/browser'
import { ScraperError, ErrorCode, createExtractionError } from '../utils/errors'

export abstract class BaseScraper {
  protected config: CountyConfig

  constructor(config: CountyConfig) {
    this.config = config
  }

  /**
   * Main scraping method - Template Method pattern
   * Defines the overall algorithm structure
   */
  async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
    const startTime = new Date().toISOString()
    const startTimestamp = Date.now()

    let browser: Browser | null = null

    try {
      // 1. Setup browser
      console.log(`[${this.config.id}] Setting up browser...`)
      browser = await this.setupBrowser()

      // 2. Create page
      const page = await createPage(browser)

      // 3. Navigate to search page
      console.log(`[${this.config.id}] Navigating to search page...`)
      await this.navigateToSearch(page)

      // 4. Perform search (county-specific)
      console.log(`[${this.config.id}] Performing search for ${request.identifier}...`)
      await this.performSearch(page, request)

      // 5. Wait for results
      console.log(`[${this.config.id}] Waiting for results...`)
      await this.waitForResults(page)

      // 6. Extract property data (county-specific)
      console.log(`[${this.config.id}] Extracting property data...`)
      const propertyData = await this.extractPropertyData(page, request)

      // 7. Validate data
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

      // Convert error to ScraperError if it isn't already
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
      // Always clean up browser
      if (browser) {
        await closeBrowser(browser)
      }
    }
  }

  /**
   * Setup browser instance
   */
  protected async setupBrowser(): Promise<Browser> {
    return await createBrowser({
      headless: true,
      timeout: this.config.timeout || 30000,
    })
  }

  /**
   * Navigate to the search page
   */
  protected async navigateToSearch(page: Page): Promise<void> {
    const url = this.config.searchUrl || this.config.appraiserUrl
    await navigateToUrl(page, url, this.config.timeout)
  }

  /**
   * Wait for search results to load
   */
  protected async waitForResults(page: Page): Promise<void> {
    if (this.config.waitForSelector) {
      await waitForSelector(page, this.config.waitForSelector, this.config.timeout)
    } else {
      // Default wait for network to be idle
      await page.waitForNetworkIdle({ timeout: this.config.timeout || 10000 })
    }
  }

  /**
   * Validate extracted property data
   */
  protected validatePropertyData(data: PropertyOwnerData): void {
    if (!data.ownerNames || data.ownerNames.length === 0) {
      throw createExtractionError(this.config.id, 'ownerNames', 'No owner names found')
    }

    if (!data.mailingAddress) {
      throw createExtractionError(this.config.id, 'mailingAddress', 'No mailing address found')
    }
  }

  /**
   * Abstract method: Perform the search
   * Each county implements this differently
   */
  protected abstract performSearch(page: Page, request: ScrapeRequest): Promise<void>

  /**
   * Abstract method: Extract property data from the results page
   * Each county implements this differently
   */
  protected abstract extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData>

  /**
   * Helper: Extract text from selector
   */
  protected async extractText(page: Page, selector: string): Promise<string | null> {
    try {
      const element = await page.$(selector)
      if (!element) return null

      const text = await page.evaluate((el) => el?.textContent?.trim() || null, element)
      return text
    } catch (error) {
      console.warn(`Failed to extract text from selector '${selector}':`, error)
      return null
    }
  }

  /**
   * Helper: Extract text from multiple selectors
   */
  protected async extractTextMultiple(page: Page, selector: string): Promise<string[]> {
    try {
      const elements = await page.$$(selector)
      const texts: string[] = []

      for (const element of elements) {
        const text = await page.evaluate((el) => el?.textContent?.trim() || '', element)
        if (text) {
          texts.push(text)
        }
      }

      return texts
    } catch (error) {
      console.warn(`Failed to extract multiple texts from selector '${selector}':`, error)
      return []
    }
  }

  /**
   * Helper: Type into input field
   */
  protected async typeIntoField(page: Page, selector: string, value: string): Promise<void> {
    try {
      await page.waitForSelector(selector, { timeout: 5000 })
      await page.focus(selector)
      await page.type(selector, value, { delay: 50 })
    } catch (error) {
      throw new ScraperError(
        ErrorCode.SEARCH_FAILED,
        `Failed to type into field '${selector}'`,
        error,
        this.config.id
      )
    }
  }

  /**
   * Helper: Click button
   */
  protected async clickButton(page: Page, selector: string): Promise<void> {
    try {
      await page.waitForSelector(selector, { timeout: 5000 })
      await page.click(selector)
    } catch (error) {
      throw new ScraperError(
        ErrorCode.SEARCH_FAILED,
        `Failed to click button '${selector}'`,
        error,
        this.config.id
      )
    }
  }

  /**
   * Helper: Check if element exists
   */
  protected async elementExists(page: Page, selector: string): Promise<boolean> {
    try {
      const element = await page.$(selector)
      return element !== null
    } catch {
      return false
    }
  }

  /**
   * Helper: Wait for navigation after action
   */
  protected async waitForNavigation(page: Page, timeout?: number): Promise<void> {
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: timeout || this.config.timeout || 30000,
    })
  }
}
