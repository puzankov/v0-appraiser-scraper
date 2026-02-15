/**
 * Custom error handling for scrapers
 */

export enum ErrorCode {
  // Configuration errors
  COUNTY_NOT_FOUND = 'COUNTY_NOT_FOUND',
  COUNTY_DISABLED = 'COUNTY_DISABLED',
  INVALID_IDENTIFIER_TYPE = 'INVALID_IDENTIFIER_TYPE',

  // Navigation errors
  NAVIGATION_FAILED = 'NAVIGATION_FAILED',
  PAGE_LOAD_TIMEOUT = 'PAGE_LOAD_TIMEOUT',

  // Search errors
  SEARCH_FAILED = 'SEARCH_FAILED',
  NO_RESULTS_FOUND = 'NO_RESULTS_FOUND',
  MULTIPLE_RESULTS_FOUND = 'MULTIPLE_RESULTS_FOUND',

  // Extraction errors
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_DATA_FORMAT = 'INVALID_DATA_FORMAT',

  // Browser errors
  BROWSER_LAUNCH_FAILED = 'BROWSER_LAUNCH_FAILED',
  BROWSER_CRASH = 'BROWSER_CRASH',

  // Generic errors
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export class ScraperError extends Error {
  public readonly code: ErrorCode
  public readonly details?: any
  public readonly countyId?: string
  public readonly identifier?: string

  constructor(
    code: ErrorCode,
    message: string,
    details?: any,
    countyId?: string,
    identifier?: string
  ) {
    super(message)
    this.name = 'ScraperError'
    this.code = code
    this.details = details
    this.countyId = countyId
    this.identifier = identifier

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ScraperError)
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      countyId: this.countyId,
      identifier: this.identifier,
    }
  }
}

// Helper functions for creating common errors
export function createCountyNotFoundError(countyId: string): ScraperError {
  return new ScraperError(
    ErrorCode.COUNTY_NOT_FOUND,
    `County '${countyId}' not found in configuration`,
    undefined,
    countyId
  )
}

export function createCountyDisabledError(countyId: string): ScraperError {
  return new ScraperError(
    ErrorCode.COUNTY_DISABLED,
    `County '${countyId}' is currently disabled`,
    undefined,
    countyId
  )
}

export function createNoResultsError(countyId: string, identifier: string): ScraperError {
  return new ScraperError(
    ErrorCode.NO_RESULTS_FOUND,
    `No results found for identifier '${identifier}' in ${countyId}`,
    undefined,
    countyId,
    identifier
  )
}

export function createExtractionError(
  countyId: string,
  field: string,
  details?: any
): ScraperError {
  return new ScraperError(
    ErrorCode.EXTRACTION_FAILED,
    `Failed to extract ${field} from page`,
    details,
    countyId
  )
}
