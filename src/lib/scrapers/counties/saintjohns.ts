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

      // Wait for content to load. qpublic/Beacon serves more than one template
      // version of the report page (which one you get can vary by client/region):
      //  - "new" template: an rptOwner repeater with [id$="_lblOwnerAddress"]
      //  - "old" template: [id*="sprPrimaryOwnerName"] inside .three/.four-column-blocks
      // Locally we tend to get the new template; on Vercel the old one has been
      // observed. Wait for EITHER so we work regardless of which is served.
      console.log(`[${this.config.id}] Waiting for property data...`)
      const OWNER_SELECTORS =
        '[id$="_lblOwnerAddress"], [id*="sprPrimaryOwnerName"], .four-column-blocks, .three-column-blocks'
      try {
        await page.waitForSelector(OWNER_SELECTORS, { timeout: this.config.timeout || 10000 })
      } catch (waitError) {
        // Neither template appeared. Capture what the page actually returned so
        // the failure is diagnosable (bot block / disclaimer / unexpected page)
        // instead of a bare timeout.
        const diag = await page
          .evaluate(() => ({
            title: document.title,
            url: location.href,
            blocked: /incapsula|incident id|request unsuccessful|access denied|are you a human|captcha/i.test(
              document.documentElement.outerHTML
            ),
            disclaimer: /disclaimer|i acknowledge|i agree|terms of use|please agree/i.test(
              (document.body ? document.body.innerText : '')
            ),
            // Visible button/link labels — if qpublic shows an "Agree" interstitial,
            // these tell us what to click to get through.
            buttons: Array.from(document.querySelectorAll('button, input[type="submit"], a.btn, a[id*="Agree"], a[id*="agree"]'))
              .map((el) => (el.textContent || (el as HTMLInputElement).value || '').trim())
              .filter(Boolean)
              .slice(0, 10),
            bodyStart: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 300),
          }))
          .catch(() => null)
        console.error(`[${this.config.id}] Owner selector not found. Page diagnostics:`, JSON.stringify(diag))
        const reason = diag?.blocked
          ? `qpublic is blocking the request (bot protection)`
          : diag?.disclaimer
            ? `qpublic served a disclaimer/agreement interstitial (buttons: ${JSON.stringify(diag.buttons)})`
            : `owner data not present on the served page`
        throw new ScraperError(
          ErrorCode.EXTRACTION_FAILED,
          `${reason}. Title: "${diag?.title ?? 'unknown'}", URL: ${diag?.url ?? 'unknown'}. Snippet: ${diag?.bodyStart ?? 'n/a'}`,
          waitError,
          this.config.id,
          request.identifier
        )
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
   * St. Johns doesn't need a search step - we navigate directly to the property page
   */
  protected async performSearch(_page: Page, _request: ScrapeRequest): Promise<void> {
    // No search needed - navigation handles everything
  }

  /**
   * Extract property data from St. Johns property details page.
   * Handles BOTH qpublic/Beacon template versions, since which one is served can
   * vary by client/region (new template seen locally, old template seen on Vercel):
   *   - new: rptOwner repeater — name in [...sprOwnerName1...lblSearch]
   *     (sprOwnerName2 is the ownership %, not a name), address in [...lblOwnerAddress]
   *   - old: [id*="sprPrimaryOwnerName"] for the name + [id*="sprPrimaryOwnerAddress"]
   *     for the owner-continuation/address block (Flagler-style)
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
        // Convert innerHTML (with <br>) into trimmed, non-empty lines
        const htmlToLines = (html: string): string[] => {
          const withMarkers = html.replace(/<br\s*\/?>/gi, '|||NEWLINE|||')
          const temp = document.createElement('div')
          temp.innerHTML = withMarkers
          const decoded = temp.textContent || ''
          return decoded
            .split('|||NEWLINE|||')
            .map(line => line.trim())
            .filter(line => line.length > 0)
        }

        // --- New template: rptOwner repeater anchored by _lblOwnerAddress ---
        const extractNew = () => {
          const ownerNames: string[] = []
          const addresses: string[] = []
          const addressEls = Array.from(document.querySelectorAll('[id$="_lblOwnerAddress"]'))
          for (const addrEl of addressEls) {
            const prefix = addrEl.id.replace(/_lblOwnerAddress$/, '')
            const nameEl = document.querySelector(`[id^="${prefix}_sprOwnerName1"][id$="lblSearch"]`)
            const ownerName = nameEl?.textContent?.trim() || ''
            if (ownerName) ownerNames.push(ownerName)
            const address = htmlToLines(addrEl.innerHTML).join('\n')
            if (address) addresses.push(address)
          }
          return { ownerNames, addresses }
        }

        // --- Old template: sprPrimaryOwnerName + sprPrimaryOwnerAddress ---
        const extractOld = () => {
          const ownerNames: string[] = []
          const addresses: string[] = []
          const nameEl = document.querySelector('[id*="sprPrimaryOwnerName"]')
          const addrEl = document.querySelector('[id*="sprPrimaryOwnerAddress"]')
          if (nameEl) {
            const primaryName = nameEl.textContent?.trim() || ''
            const ownerParts: string[] = primaryName ? [primaryName] : []
            const addressParts: string[] = []
            if (addrEl) {
              for (const line of htmlToLines(addrEl.innerHTML)) {
                // Address lines start with a street number or a "City ST ZIP" tail;
                // anything before that is owner-continuation (e.g. a second owner).
                if (/^\d+/.test(line) || /[A-Z]{2}\s+\d{5}/.test(line) || addressParts.length > 0) {
                  addressParts.push(line)
                } else {
                  ownerParts.push(line)
                }
              }
            }
            if (ownerParts.length) ownerNames.push(ownerParts.join('\n'))
            if (addressParts.length) addresses.push(addressParts.join('\n'))
          }
          return { ownerNames, addresses }
        }

        // Prefer the new template; fall back to the old one
        let res = extractNew()
        let template = 'new'
        if (res.ownerNames.length === 0) {
          res = extractOld()
          template = 'old'
        }

        return {
          ownerName: res.ownerNames.join('\n'),
          mailingAddress: [...new Set(res.addresses)].join('\n'),
          template,
        }
      })

      console.log(`[${this.config.id}] Extracted via "${data.template}" template`)

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
