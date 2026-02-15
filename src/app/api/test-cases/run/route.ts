/**
 * Run test case API endpoint (without saving)
 * POST /api/test-cases/run - Run a test case without saving it
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateTestCaseInput } from '@/lib/scrapers/utils/validators'
import { runTestCase } from '@/lib/testing/TestRunner'
import { ZodError } from 'zod'
import { ErrorCode } from '@/lib/scrapers/utils/errors'

export const dynamic = 'force-dynamic'

/**
 * POST /api/test-cases/run
 * Run a test case without saving it to disk
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

    // Create a temporary test case object (not saved to disk)
    const tempTestCase = {
      id: 'temp-' + Date.now(),
      ...testCaseInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    console.log(`[API] Running temporary test case: ${tempTestCase.name}`)

    // Run the test case
    const result = await runTestCase(tempTestCase)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[API] Failed to run test case:', error)

    return NextResponse.json(
      {
        error: {
          code: 'TEST_RUN_FAILED',
          message: error instanceof Error ? error.message : 'Failed to run test',
        },
      },
      { status: 500 }
    )
  }
}
