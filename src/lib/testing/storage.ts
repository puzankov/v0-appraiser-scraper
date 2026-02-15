/**
 * File-based test case storage
 */

import fs from 'fs/promises'
import path from 'path'
import { TestCase, TestCaseInput } from '@/types/test'
import { v4 as uuidv4 } from 'uuid'

const TEST_CASES_DIR = path.join(process.cwd(), 'test-cases')

/**
 * Ensure test cases directory exists
 */
async function ensureTestCasesDir(): Promise<void> {
  try {
    await fs.mkdir(TEST_CASES_DIR, { recursive: true })
  } catch (error) {
    console.error('Failed to create test-cases directory:', error)
  }
}

/**
 * Generate filename for a test case
 */
function getTestCaseFilename(id: string): string {
  return path.join(TEST_CASES_DIR, `${id}.json`)
}

/**
 * Save a test case to file
 */
export async function saveTestCase(input: TestCaseInput, existingId?: string): Promise<TestCase> {
  await ensureTestCasesDir()

  const id = existingId || uuidv4()
  const now = new Date().toISOString()

  const testCase: TestCase = {
    id,
    ...input,
    createdAt: existingId ? (await loadTestCase(existingId)).createdAt : now,
    updatedAt: now,
  }

  const filename = getTestCaseFilename(id)
  await fs.writeFile(filename, JSON.stringify(testCase, null, 2), 'utf-8')

  return testCase
}

/**
 * Load a test case from file
 */
export async function loadTestCase(id: string): Promise<TestCase> {
  const filename = getTestCaseFilename(id)

  try {
    const content = await fs.readFile(filename, 'utf-8')
    return JSON.parse(content) as TestCase
  } catch (error) {
    throw new Error(`Test case '${id}' not found`)
  }
}

/**
 * Load all test cases
 */
export async function loadAllTestCases(): Promise<TestCase[]> {
  await ensureTestCasesDir()

  try {
    const files = await fs.readdir(TEST_CASES_DIR)
    const jsonFiles = files.filter((file) => file.endsWith('.json'))

    const testCases: TestCase[] = []
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(TEST_CASES_DIR, file), 'utf-8')
        const testCase = JSON.parse(content) as TestCase
        testCases.push(testCase)
      } catch (error) {
        console.warn(`Failed to load test case from ${file}:`, error)
      }
    }

    return testCases
  } catch (error) {
    console.error('Failed to load test cases:', error)
    return []
  }
}

/**
 * Delete a test case
 */
export async function deleteTestCase(id: string): Promise<void> {
  const filename = getTestCaseFilename(id)

  try {
    await fs.unlink(filename)
  } catch (error) {
    throw new Error(`Failed to delete test case '${id}'`)
  }
}

/**
 * Check if a test case exists
 */
export async function testCaseExists(id: string): Promise<boolean> {
  const filename = getTestCaseFilename(id)

  try {
    await fs.access(filename)
    return true
  } catch {
    return false
  }
}
