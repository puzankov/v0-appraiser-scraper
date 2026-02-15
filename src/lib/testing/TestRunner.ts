/**
 * Test runner for executing and validating test cases
 */

import { TestCase, TestResult, TestAssertion, BatchTestResult } from '@/types/test'
import { loadCountyConfig } from '@/lib/config/counties'
import { getScraper } from '@/lib/scrapers/base/ScraperFactory'
import { ScrapeRequest } from '@/types/scraper'

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses simple character-based similarity
 */
function calculateSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeText(str1)
  const norm2 = normalizeText(str2)

  if (norm1 === norm2) return 1.0

  // Calculate Levenshtein distance-based similarity
  const maxLength = Math.max(norm1.length, norm2.length)
  if (maxLength === 0) return 1.0

  const distance = levenshteinDistance(norm1, norm2)
  return 1 - distance / maxLength
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

/**
 * Run a single test case
 */
export async function runTestCase(testCase: TestCase): Promise<TestResult> {
  const startTime = Date.now()
  const executedAt = new Date().toISOString()

  try {
    // Load county config
    const countyConfig = loadCountyConfig(testCase.countyId)

    // Get scraper
    const scraper = await getScraper(countyConfig)

    // Create scrape request
    const request: ScrapeRequest = {
      countyId: testCase.countyId,
      identifierType: testCase.identifierType,
      identifier: testCase.identifier,
    }

    // Execute scrape
    const scrapeResult = await scraper.scrape(request)

    const duration = Date.now() - startTime

    // If scrape failed, test fails
    if (!scrapeResult.success) {
      return {
        testCaseId: testCase.id,
        testCaseName: testCase.name,
        passed: false,
        scrapeResult,
        assertions: [],
        executedAt,
        duration,
        error: scrapeResult.error?.message || 'Scrape failed',
      }
    }

    // Perform assertions
    const assertions: TestAssertion[] = []

    // Check owner name
    const actualOwnerName = scrapeResult.data?.ownerNames.join(', ') || ''
    const ownerNameSimilarity = calculateSimilarity(actualOwnerName, testCase.expectedOwnerName)
    assertions.push({
      field: 'ownerName',
      expected: testCase.expectedOwnerName,
      actual: actualOwnerName,
      passed: ownerNameSimilarity >= 0.8, // 80% similarity threshold
      similarity: ownerNameSimilarity,
    })

    // Check address
    const actualAddress = typeof scrapeResult.data?.mailingAddress === 'string'
      ? scrapeResult.data.mailingAddress
      : scrapeResult.data?.mailingAddress.raw || ''
    const addressSimilarity = calculateSimilarity(actualAddress, testCase.expectedAddress)
    assertions.push({
      field: 'mailingAddress',
      expected: testCase.expectedAddress,
      actual: actualAddress,
      passed: addressSimilarity >= 0.8, // 80% similarity threshold
      similarity: addressSimilarity,
    })

    // Test passes if all assertions pass
    const passed = assertions.every((a) => a.passed)

    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      passed,
      scrapeResult,
      assertions,
      executedAt,
      duration,
    }
  } catch (error) {
    const duration = Date.now() - startTime

    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      passed: false,
      scrapeResult: {
        success: false,
        error: {
          code: 'TEST_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        metadata: {
          countyId: testCase.countyId,
          identifier: testCase.identifier,
          identifierType: testCase.identifierType,
          startTime: executedAt,
          endTime: new Date().toISOString(),
          duration,
        },
      },
      assertions: [],
      executedAt,
      duration,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Run multiple test cases
 */
export async function runTestCases(testCases: TestCase[]): Promise<BatchTestResult> {
  const startTime = Date.now()
  const executedAt = new Date().toISOString()

  const results: TestResult[] = []

  for (const testCase of testCases) {
    console.log(`Running test: ${testCase.name}`)
    const result = await runTestCase(testCase)
    results.push(result)
  }

  const passedTests = results.filter((r) => r.passed).length
  const failedTests = results.filter((r) => !r.passed).length
  const totalDuration = Date.now() - startTime

  return {
    totalTests: testCases.length,
    passedTests,
    failedTests,
    results,
    executedAt,
    totalDuration,
  }
}
