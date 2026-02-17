/**
 * Test cases API endpoints
 * GET /api/test-cases - List all test cases
 * POST /api/test-cases - Create a new test case
 */

import { NextRequest, NextResponse } from 'next/server'
import { saveTestCase, loadAllTestCases } from '@/lib/testing/storage'
import { validateTestCaseInput } from '@/lib/scrapers/utils/validators'
import { runTestCases } from '@/lib/testing/TestRunner'
import { ZodError } from 'zod'
import { ErrorCode } from '@/lib/scrapers/utils/errors'

export const dynamic = 'force-dynamic'

/**
 * GET /api/test-cases
 * List all test cases or run all tests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const runTests = searchParams.get('run') === 'true'

    const testCases = await loadAllTestCases()

    // If run=true, execute all test cases
    if (runTests) {
      console.log(`[API] Running ${testCases.length} test cases...`)
      const batchResult = await runTestCases(testCases)
      return NextResponse.json(batchResult)
    }

    // Otherwise, just return the list
    return NextResponse.json({
      testCases,
      count: testCases.length,
    })
  } catch (error) {
    console.error('[API] Failed to load test cases:', error)

    return NextResponse.json(
      {
        error: {
          code: 'LOAD_TEST_CASES_FAILED',
          message: 'Failed to load test cases',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/test-cases
 * Create a new test case
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    let testCaseInput
    try {
      testCaseInput = validateTestCaseInput(body)
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            error: {
              code: ErrorCode.VALIDATION_ERROR,
              message: 'Invalid test case data',
              details: error.errors,
            },
          },
          { status: 400 }
        )
      }
      throw error
    }

    // Save test case
    const testCase = await saveTestCase(testCaseInput)

    return NextResponse.json(
      {
        testCase,
        message: 'Test case created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[API] Failed to create test case:', error)

    return NextResponse.json(
      {
        error: {
          code: 'CREATE_TEST_CASE_FAILED',
          message: 'Failed to create test case',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    )
  }
}
