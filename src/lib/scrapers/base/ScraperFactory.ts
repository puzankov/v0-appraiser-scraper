/**
 * Factory for creating county-specific scraper instances
 * Implements singleton pattern for caching
 */

import { BaseScraper } from './BaseScraper'
import { CountyConfig } from '@/types/scraper'
import { ScraperError, ErrorCode } from '../utils/errors'

// Cache for scraper instances
const scraperCache = new Map<string, BaseScraper>()

/**
 * Get or create a scraper instance for a county
 */
export async function getScraper(config: CountyConfig): Promise<BaseScraper> {
  // Return cached instance if exists
  if (scraperCache.has(config.id)) {
    return scraperCache.get(config.id)!
  }

  // Dynamically import the county scraper module
  try {
    const scraperModule = await import(`../counties/${config.scraperModule}`)

    // Get the default export (the scraper class)
    const ScraperClass = scraperModule.default

    if (!ScraperClass) {
      throw new Error(`No default export found in scraper module '${config.scraperModule}'`)
    }

    // Create instance
    const scraper = new ScraperClass(config)

    // Verify it extends BaseScraper
    if (!(scraper instanceof BaseScraper)) {
      throw new Error(`Scraper '${config.scraperModule}' does not extend BaseScraper`)
    }

    // Cache and return
    scraperCache.set(config.id, scraper)
    return scraper
  } catch (_error) {
    console.error(`Failed to load scraper for county '${config.id}':`, error)
    throw new ScraperError(
      ErrorCode.UNKNOWN_ERROR,
      `Failed to load scraper for county '${config.id}'`,
      error,
      config.id
    )
  }
}

/**
 * Clear the scraper cache (useful for testing/development)
 */
export function clearScraperCache(): void {
  scraperCache.clear()
}

/**
 * Get cached scraper instance count (for monitoring)
 */
export function getScraperCacheSize(): number {
  return scraperCache.size
}
