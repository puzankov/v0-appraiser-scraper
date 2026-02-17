/**
 * Browser automation utility with Vercel compatibility
 * Uses chromium-min for serverless (downloads at runtime) and puppeteer for local dev
 */

import { Browser, Page } from 'puppeteer-core'

// Detect if running on Vercel/production
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

// Browser configuration
interface BrowserConfig {
  headless?: boolean
  timeout?: number
}

/**
 * Create a Puppeteer browser instance
 * Production: Uses chromium-min (downloads Chromium binary at runtime from GitHub)
 * Local: Uses regular puppeteer with bundled Chromium
 */
export async function createBrowser(config: BrowserConfig = {}): Promise<Browser> {
  const { headless = true } = config

  try {
    let puppeteer: any
    let executablePath: string | undefined
    let chromiumArgs: string[] = []
    let chromiumInstance: any = null

    if (isProduction) {
      // Production: Use puppeteer-core + chromium-min
      console.log('Creating browser for Vercel environment with chromium-min')

      puppeteer = await import('puppeteer-core')
      chromiumInstance = await import('@sparticuz/chromium-min')

      // Downloads Chromium binary from GitHub releases at runtime
      executablePath = await chromiumInstance.default.executablePath(
        'https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar'
      )
      chromiumArgs = chromiumInstance.default.args
    } else {
      // Local dev: Use regular puppeteer with bundled Chromium
      console.log('Creating browser for local environment')
      try {
        puppeteer = await import('puppeteer')
      } catch {
        puppeteer = await import('puppeteer-core')
      }
    }

    const launchOptions = isProduction && chromiumInstance
      ? {
          args: chromiumArgs,
          defaultViewport: chromiumInstance.default.defaultViewport,
          executablePath: executablePath,
          headless: chromiumInstance.default.headless,
          ignoreHTTPSErrors: true,
        }
      : {
          headless,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
          ],
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ||
                         '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          ignoreHTTPSErrors: true,
        }

    const browser = await puppeteer.default.launch(launchOptions)
    return browser
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    console.error('Error closing browser:', error)
  }
}
