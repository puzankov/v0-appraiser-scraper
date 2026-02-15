/**
 * Core types for the property scraper system
 */

// Identifier types that can be used to search for properties
export type IdentifierType = 'parcelId' | 'folio' | 'address' | 'ownerName'

// Request to scrape property data
export interface ScrapeRequest {
  countyId: string
  identifierType: IdentifierType
  identifier: string
}

// Property owner data extracted from county websites
export interface PropertyOwnerData {
  ownerNames: string[]
  mailingAddress: MailingAddress | string // Can be structured or raw string
  countyId: string
  identifier: string
  identifierType: IdentifierType
  scrapedAt: string // ISO timestamp
  additionalData?: Record<string, any> // For extra fields like property value, tax info, etc.
}

// Structured mailing address
export interface MailingAddress {
  street: string
  city: string
  state: string
  zipCode: string
  raw?: string // Original raw text if available
}

// Result of a scraping operation
export interface ScrapeResult {
  success: boolean
  data?: PropertyOwnerData
  error?: ScraperErrorInfo
  metadata: ScrapeMetadata
}

// Error information
export interface ScraperErrorInfo {
  code: string
  message: string
  details?: any
}

// Metadata about the scraping operation
export interface ScrapeMetadata {
  countyId: string
  identifier: string
  identifierType: IdentifierType
  startTime: string
  endTime: string
  duration: number // milliseconds
  attemptNumber?: number
}

// County configuration
export interface CountyConfig {
  id: string
  name: string
  state: string
  appraiserUrl: string
  searchUrl: string
  identifierTypes: IdentifierType[]
  scraperModule: string // Name of the scraper class file
  selectors: CountySelectors
  waitForSelector?: string
  timeout?: number
  enabled: boolean
  notes?: string
}

// Selectors for extracting data from county websites
export interface CountySelectors {
  searchInput?: string
  searchButton?: string
  ownerName?: string | string[] // Can be single selector or multiple
  mailingAddress?: string | string[]
  // Additional selectors for more complex extraction
  ownerNameMultiple?: string // For sites with multiple owner name elements
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  zipCode?: string
  resultsTable?: string
  resultsRow?: string
  noResultsIndicator?: string
  [key: string]: string | string[] | undefined // Allow custom selectors
}
