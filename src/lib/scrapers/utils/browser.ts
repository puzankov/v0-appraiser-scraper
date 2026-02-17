/**
 * Browser automation utility with Vercel compatibility
 */

import puppeteer, { Browser, Page } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

// Detect if running on Vercel (production) or local
const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME

// Browser configuration
interface BrowserConfig {
  headless?: boolean
  timeout?: number
}

/**
 * Create a Puppeteer browser instance
 * Uses @sparticuz/chromium on Vercel, local Chromium otherwise
 */
export async function createBrowser(config: BrowserConfig = {}): Promise<Browser> {
  const { headless = true, timeout = 30000 } = config

  try {
    if (isVercel) {
      // Production environment (Vercel)
      console.log('Creating browser for Vercel environment')

      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      })

      return browser
    } else {
      // Local development environment
      console.log('Creating browser for local environment')

      // Try to find local Chrome/Chromium installation
      const browser = await puppeteer.launch({
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920x1080',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ||
                       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ignoreHTTPSErrors: true,
        timeout,
      })

      return browser
    }
  } catch (_error) {
    console.error('Failed to launch browser:', error)
    throw new Error(`Browser launch failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Create a new page with common settings
 */
export async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()

  // Set viewport
  await page.setViewport({
    width: 1920,
    height: 1080,
  })

  // Set user agent to avoid bot detection
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  // Block unnecessary resources for faster loading
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const resourceType = req.resourceType()
    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
      req.abort()
    } else {
      req.continue()
    }
  })

  return page
}

/**
 * Safe navigation with timeout and error handling
 */
export async function navigateToUrl(
  page: Page,
  url: string,
  timeout: number = 30000
): Promise<void> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout,
    })
  } catch (_error) {
    throw new Error(`Navigation to ${url} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Wait for selector with timeout
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout: number = 10000
): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout })
  } catch (_error) {
    throw new Error(`Selector '${selector}' not found within ${timeout}ms`)
  }
}

/**
 * Safely close browser
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  try {
    await browser.close()
  } catch (_error) {
    console.error('Error closing browser:', error)
  }
}
