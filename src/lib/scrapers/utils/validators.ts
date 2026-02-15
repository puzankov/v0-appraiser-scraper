/**
 * Request validation using Zod schemas
 */

import { z } from 'zod'

// Identifier type enum
export const IdentifierTypeSchema = z.enum(['parcelId', 'folio', 'address', 'ownerName'])

// Scrape request schema
export const ScrapeRequestSchema = z.object({
  countyId: z.string().min(1, 'County ID is required'),
  identifierType: IdentifierTypeSchema,
  identifier: z.string().min(1, 'Identifier is required'),
})

// Test case input schema
export const TestCaseInputSchema = z.object({
  name: z.string().min(1, 'Test case name is required'),
  countyId: z.string().min(1, 'County ID is required'),
  identifierType: IdentifierTypeSchema,
  identifier: z.string().min(1, 'Identifier is required'),
  expectedOwnerName: z.string().min(1, 'Expected owner name is required'),
  expectedAddress: z.string().min(1, 'Expected address is required'),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

// Validate scrape request
export function validateScrapeRequest(data: unknown) {
  return ScrapeRequestSchema.parse(data)
}

// Validate test case input
export function validateTestCaseInput(data: unknown) {
  return TestCaseInputSchema.parse(data)
}

// Type guards
export function isValidIdentifierType(type: string): boolean {
  return ['parcelId', 'folio', 'address', 'ownerName'].includes(type)
}
