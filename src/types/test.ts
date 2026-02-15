/**
 * Testing system types
 */

import { IdentifierType, ScrapeResult } from './scraper'

// Test case for regression testing
export interface TestCase {
  id: string
  name: string
  countyId: string
  identifierType: IdentifierType
  identifier: string
  expectedOwnerName: string
  expectedAddress: string
  description?: string
  createdAt: string
  updatedAt: string
  tags?: string[]
}

// Result of running a test case
export interface TestResult {
  testCaseId: string
  testCaseName: string
  passed: boolean
  scrapeResult: ScrapeResult
  assertions: TestAssertion[]
  executedAt: string
  duration: number // milliseconds
  error?: string
}

// Individual assertion in a test
export interface TestAssertion {
  field: string
  expected: string
  actual: string
  passed: boolean
  similarity?: number // 0-1 for fuzzy matching
}

// Batch test execution result
export interface BatchTestResult {
  totalTests: number
  passedTests: number
  failedTests: number
  results: TestResult[]
  executedAt: string
  totalDuration: number
}

// Test case creation/update request
export interface TestCaseInput {
  name: string
  countyId: string
  identifierType: IdentifierType
  identifier: string
  expectedOwnerName: string
  expectedAddress: string
  description?: string
  tags?: string[]
}
