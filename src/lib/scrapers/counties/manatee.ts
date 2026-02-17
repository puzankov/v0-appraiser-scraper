/**
 * Manatee County Property Appraiser Scraper
 * URL Pattern: https://www.manateepao.gov/parcel/?parid={parcelId}
 * Note: Uses iframe for owner content - requires switching context
 */

import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'
import { ScraperError, ErrorCode, createNoResultsError } from '../utils/errors'

export default class ManateeScraper extends BaseScraper {
  /**
   * Manatee uses direct URL navigation with parid as query parameter
   */
  protected async navigateToSearch(page: Page, request?: ScrapeRequest): Promise<void> {
    if (!request) {
      throw new ScraperError(
        ErrorCode.VALIDATION_ERROR,
        'Request is required for Manatee County navigation',
        undefined,
        this.config.id
      )
    }

    // Construct the direct URL with the parid
    const url = `${this.config.searchUrl}?parid=${request.identifier}`

    console.log(`[${this.config.id}] Navigating to: ${url}`)

    // Manatee needs networkidle0 and longer timeout
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 120000,
    })

    // Wait additional time for all content to populate
    console.log(`[${this.config.id}] Waiting for content to fully load...`)
    await new Promise(resolve => setTimeout(resolve, 10000))
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

      // Create page without using createPage (which blocks resources)
      // Manatee needs all resources to load properly
      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )

      // Navigate directly to property page
      await this.navigateToSearch(page, request)

      // Wait for page to load
      console.log(`[${this.config.id}] Waiting for page to render...`)

      // Extract from main page (content should be loaded after the wait above)
      console.log(`[${this.config.id}] Extracting property data...`)
      const propertyData = await this.extractFromMainPage(page, request)

      if (!propertyData) {
        throw createNoResultsError(this.config.id, request.identifier)
      }

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
   * Manatee doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from the iframe (not used - see extractPropertyDataFromFrame)
   */
  protected async extractPropertyData(
    _page: Page,
    _request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    // This method is not used for Manatee since we override scrape()
    throw new Error('Use extractPropertyDataFromFrame or extractFromMainPage instead')
  }

  /**
   * Try to extract property data from the main page (before checking iframe)
   * Manatee County uses Bootstrap grid with label/value pairs
   */
  private async extractFromMainPage(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData | null> {
    const { identifier, identifierType } = request

    try {
      const data = await page.evaluate(() => {
        let ownerName = ''
        let mailingAddress = ''

        // Manatee structure: <div class="row no-gutters">
        //   <div class="col-sm-2 text-sm-right">Label:</div>
        //   <div class="col-sm ml-2">Value</div>
        // </div>

        // Find all rows within ownerContent div to avoid other page content
        const ownerContent = document.querySelector('#ownerContent')
        if (!ownerContent) {
          return { ownerName: '', mailingAddress: '' }
        }

        const rows = ownerContent.querySelectorAll('.row.no-gutters')

        for (const row of rows) {
          const columns = row.querySelectorAll('div[class*="col-"]')
          if (columns.length >= 2) {
            const labelEl = columns[0]
            const valueEl = columns[1]

            const label = labelEl.textContent?.trim().toLowerCase() || ''

            // Get only direct text content, excluding script tags and nested elements
            let value = ''
            for (const node of valueEl.childNodes) {
              if (node.nodeType === Node.TEXT_NODE) {
                value += node.textContent || ''
              } else if (node.nodeName !== 'SCRIPT' && node.nodeType === Node.ELEMENT_NODE) {
                // Get text from element but skip scripts
                const el = node as Element
                if (el.tagName !== 'SCRIPT') {
                  value += el.textContent || ''
                }
              }
            }
            value = value.trim()

            // Look for "Ownership:" label
            if (!ownerName && label.includes('ownership')) {
              ownerName = value
            }

            // Look for "Mailing Address:" label
            if (!mailingAddress && label.includes('mailing address')) {
              mailingAddress = value
            }
          }
        }

        return {
          ownerName: ownerName.trim(),
          mailingAddress: mailingAddress.trim()
        }
      })

      if (data.ownerName && data.mailingAddress) {
        console.log(`[${this.config.id}] Successfully extracted from main page`)
        console.log(`[${this.config.id}] Owner: ${data.ownerName}`)
        console.log(`[${this.config.id}] Address: ${data.mailingAddress}`)

        return {
          ownerNames: [data.ownerName],
          mailingAddress: data.mailingAddress,
          countyId: this.config.id,
          identifier,
          identifierType,
          scrapedAt: new Date().toISOString(),
        }
      }

      console.log(`[${this.config.id}] Could not extract from main page`)
      console.log(`[${this.config.id}] Owner found: ${!!data.ownerName}, Address found: ${!!data.mailingAddress}`)
      return null
    } catch (error) {
      console.error(`[${this.config.id}] Error extracting from main page:`, error)
      return null
    }
  }

  /**
   * Extract property data from Manatee iframe content
   */
  private async extractPropertyDataFromFrame(
    frame: any,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData | null> {
    const { identifier, identifierType } = request

    try {
      // Extract data from iframe
      const data = await frame.evaluate(() => {
        const bodyText = document.body.innerText

        // Helper to clean text
        const cleanText = (text: string): string => {
          return text.trim().replace(/\s+/g, ' ')
        }

        let ownerName = ''
        let mailingAddress = ''

        // Strategy 1: Look for common label patterns in lines
        const lines = bodyText.split('\n').map(line => line.trim()).filter(line => line.length > 0)

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const lowerLine = line.toLowerCase()

          // Look for "Owner" or "Owner Name" label (case insensitive)
          if (!ownerName) {
            if (lowerLine.match(/^owner\s*:?$|^owner\s+name\s*:?$/)) {
              // Owner label found, next line(s) should be the name
              if (i + 1 < lines.length) {
                ownerName = lines[i + 1]
              }
            }
            // Sometimes label and value are on same line
            const ownerMatch = line.match(/owner\s*:?\s+(.+)/i)
            if (ownerMatch && ownerMatch[1].length > 3) {
              ownerName = ownerMatch[1]
            }
          }

          // Look for "Mailing Address" label
          if (!mailingAddress) {
            if (lowerLine.match(/^mailing\s+address\s*:?$|^address\s*:?$/)) {
              // Address label found, next lines are the address
              const addressLines = []
              for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                const addressLine = lines[j]
                // Stop if we hit another label (ends with :) or looks like a new section
                if (addressLine.match(/^[A-Za-z\s]+:/) || addressLine.length < 2) break
                addressLines.push(addressLine)
              }
              if (addressLines.length > 0) {
                mailingAddress = addressLines.join('\n')
              }
            }
            // Sometimes label and value are on same line
            const addressMatch = line.match(/(?:mailing\s+)?address\s*:?\s+(.+)/i)
            if (addressMatch && addressMatch[1].length > 10) {
              mailingAddress = addressMatch[1]
            }
          }
        }

        // Strategy 2: Look for table structure (common in property appraisers)
        if (!ownerName || !mailingAddress) {
          const tables = document.querySelectorAll('table')
          for (const table of tables) {
            const rows = table.querySelectorAll('tr')
            for (const row of rows) {
              const cells = row.querySelectorAll('td, th')
              if (cells.length >= 2) {
                const label = cells[0].textContent?.trim().toLowerCase() || ''
                const value = cells[1].textContent?.trim() || ''

                if (!ownerName && label.match(/owner|name/) && value.length > 3) {
                  ownerName = value
                }
                if (!mailingAddress && label.match(/mailing|address/) && value.length > 10) {
                  mailingAddress = value
                }
              }
            }
          }
        }

        // Strategy 3: Look for divs/spans with specific classes
        if (!ownerName) {
          const selectors = ['[class*="owner"]', '[id*="owner"]', '.name', '[class*="name"]']
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector)
            for (const el of elements) {
              const text = el.textContent?.trim() || ''
              // Filter out labels and too short/long text
              if (text.length > 5 && text.length < 200 && !text.match(/owner\s*:?$/i)) {
                ownerName = text
                break
              }
            }
            if (ownerName) break
          }
        }

        if (!mailingAddress) {
          const selectors = ['[class*="address"]', '[class*="mailing"]', '[id*="address"]', '[id*="mailing"]']
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector)
            for (const el of elements) {
              const text = el.textContent?.trim() || ''
              if (text.length > 10 && text.length < 300 && !text.match(/address\s*:?$/i)) {
                mailingAddress = text
                break
              }
            }
            if (mailingAddress) break
          }
        }

        // Strategy 4: Pattern matching - look for all caps text (common in property records)
        if (!ownerName) {
          const allCapsPattern = /\b([A-Z][A-Z\s&',.-]{10,100})\b/g
          const matches = bodyText.match(allCapsPattern)
          if (matches && matches.length > 0) {
            // Take the first match that looks like a name (not just random caps)
            for (const match of matches) {
              if (match.length > 10 && match.length < 100) {
                ownerName = match.trim()
                break
              }
            }
          }
        }

        return {
          ownerName: cleanText(ownerName),
          mailingAddress: cleanText(mailingAddress),
          // Return iframe HTML and text for debugging
          debugHtml: document.body.innerHTML.substring(0, 8000),
          debugText: bodyText.substring(0, 2000)
        }
      })

      // Check if we found the required data
      if (!data.ownerName || !data.mailingAddress) {
        console.log(`[${this.config.id}] Could not find data in iframe`)
        if (data.debugText) {
          console.log(`[${this.config.id}] Iframe text:`, data.debugText.substring(0, 500))
        }
        return null
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
      console.error(`[${this.config.id}] Error extracting from iframe:`, error)
      return null
    }
  }
}
