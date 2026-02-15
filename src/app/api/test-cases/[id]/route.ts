/**
 * Individual test case API endpoints
 * GET /api/test-cases/:id - Get a specific test case
 * PUT /api/test-cases/:id - Update a test case
 * DELETE /api/test-cases/:id - Delete a test case
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadTestCase, saveTestCase, deleteTestCase, testCaseExists } from '@/lib/testing/storage'
import { validateTestCaseInput } from '@/lib/scrapers/utils/validators'
import { runTestCase } from '@/lib/testing/TestRunner'
import { ZodError } from 'zod'
import { ErrorCode } from '@/lib/scrapers/utils/errors'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: {
    id: string
  }
}

/**
 * GET /api/test-cases/:id
 * Get a specific test case or run it
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params
    const { searchParams } = new URL(request.url)
    const run = searchParams.get('run') === 'true'

    const testCase = await loadTestCase(id)

    // If run=true, execute the test case
    if (run) {
      console.log(`[API] Running test case: ${testCase.name}`)
      const result = await runTestCase(testCase)
      return NextResponse.json(result)
    }

    // Otherwise, return the test case
    return NextResponse.json({ testCase })
  } catch (error) {
    console.error('[API] Failed to load test case:', error)

    return NextResponse.json(
      {
        error: {
          code: 'TEST_CASE_NOT_FOUND',
          message: error instanceof Error ? error.message : 'Test case not found',
        },
      },
      { status: 404 }
    )
  }
}

/**
 * PUT /api/test-cases/:id
 * Update a test case
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params

    // Check if test case exists
    const exists = await testCaseExists(id)
    if (!exists) {
      return NextResponse.json(
        {
          error: {
            code: 'TEST_CASE_NOT_FOUND',
            message: `Test case '${id}' not found`,
          },
        },
        { status: 404 }
      )
    }

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

    // Update test case
    const testCase = await saveTestCase(testCaseInput, id)

    return NextResponse.json({
      testCase,
      message: 'Test case updated successfully',
    })
  } catch (error) {
    console.error('[API] Failed to update test case:', error)

    return NextResponse.json(
      {
        error: {
          code: 'UPDATE_TEST_CASE_FAILED',
          message: 'Failed to update test case',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/test-cases/:id
 * Delete a test case
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params

    await deleteTestCase(id)

    return NextResponse.json({
      message: 'Test case deleted successfully',
    })
  } catch (error) {
    console.error('[API] Failed to delete test case:', error)

    return NextResponse.json(
      {
        error: {
          code: 'DELETE_TEST_CASE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to delete test case',
        },
      },
      { status: 404 }
    )
  }
}
