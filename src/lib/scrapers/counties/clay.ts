/**
 * Clay County Property Appraiser Scraper
 * URL Pattern: https://qpublic.schneidercorp.com/Application.aspx?AppID=830&LayerID=15008&PageTypeID=4&PageID=6756&Q=...&KeyValue={parcelId}
 *
 * Note: This county can have MULTIPLE OWNERS, each with their own address
 * Owner names are merged with newlines
 * Addresses are merged with newlines
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class ClayScraper extends BaseScraper {
  /**
   * Clay uses direct URL navigation with parcelId as KeyValue parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Clay County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with parcelId as KeyValue parameter
    // Note: The Q parameter seems to be a hash/ID that changes, but KeyValue is the parcelId
    const url = `${this.config.searchUrl}?AppID=830&LayerID=15008&PageTypeID=4&PageID=6756&KeyValue=${encodeURIComponent(request.identifier)}`

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
      await page.waitForSelector('.three-column-blocks', { timeout: this.config.timeout || 10000 })

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
   * Clay doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from Clay property details page
   * This county can have MULTIPLE owners, each in a separate div.three-column-blocks
   * We need to extract all owners and merge them
   */
  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    const { identifier, identifierType } = request

    try {
      // Extract data using page.evaluate to run in browser context
      const data = await page.evaluate(() => {
        // Helper to decode HTML entities and clean text
        const cleanText = (text: string): string => {
          const temp = document.createElement('div')
          temp.innerHTML = text
          return (temp.textContent || '').trim()
        }

        const ownerNames: string[] = []
        const addresses: string[] = []

        // Find all three-column-blocks divs (each represents one owner)
        const ownerBlocks = Array.from(document.querySelectorAll('.three-column-blocks'))

        for (const block of ownerBlocks) {
          // Extract owner name - can be in <span> or <a> tag
          // Look for the first span or a that's not an address-related element
          const firstChild = block.firstElementChild
          let ownerName = ''

          if (firstChild) {
            // The first element is usually the owner name (span or a)
            if (firstChild.tagName === 'SPAN' || firstChild.tagName === 'A') {
              ownerName = cleanText(firstChild.textContent || '')
            }
          }

          if (!ownerName) {
            // Fallback: look for any span or a that doesn't have an id containing 'Address' or 'City'
            const nameElements = Array.from(block.querySelectorAll('span, a'))
            for (const el of nameElements) {
              const id = el.getAttribute('id') || ''
              if (!id.includes('Address') && !id.includes('City') && !id.includes('Zip')) {
                const text = cleanText(el.textContent || '')
                if (text && text.length > 0) {
                  ownerName = text
                  break
                }
              }
            }
          }

          // Extract address parts
          let address1 = ''
          let address2 = ''
          let cityStateZip = ''

          // Look for spans with specific id patterns
          const spans = Array.from(block.querySelectorAll('span'))
          for (const span of spans) {
            const id = span.getAttribute('id') || ''
            const text = cleanText(span.textContent || '')

            if (id.includes('lblAddress1') && text) {
              address1 = text
            } else if (id.includes('lblAddress2') && text) {
              address2 = text
            } else if (id.includes('lblCityStateZip') && text) {
              cityStateZip = text
            }
          }

          // Build the full address
          const addressParts = [address1, address2, cityStateZip].filter(part => part.length > 0)
          const fullAddress = addressParts.join('\n')

          // Add to arrays if we found data
          if (ownerName) {
            ownerNames.push(ownerName)
          }
          if (fullAddress) {
            addresses.push(fullAddress)
          }
        }

        // Merge all owners with newlines
        const mergedOwners = ownerNames.join('\n')

        // Deduplicate addresses - only include unique addresses
        const uniqueAddresses = [...new Set(addresses)]
        const mergedAddresses = uniqueAddresses.join('\n')

        return {
          ownerName: mergedOwners,
          mailingAddress: mergedAddresses
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
