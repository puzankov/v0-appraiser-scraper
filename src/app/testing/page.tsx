/**
 * Testing console page
 */

'use client'

import React, { useState } from 'react'
import { TestForm } from '@/components/testing/TestForm'
import { TestResults } from '@/components/testing/TestResults'
import { TestCaseList } from '@/components/testing/TestCaseList'
import { TestResult } from '@/types/test'

export default function TestingPage() {
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleTestResult = (result: TestResult) => {
    setTestResult(result)
  }

  const handleTestSaved = () => {
    setRefreshTrigger((prev) => prev + 1)
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Testing Console</h1>
          <p className="text-gray-600 mt-2">
            Test property scrapers and manage regression test cases
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Left: Test Form */}
          <div>
            <TestForm
              onTestResult={handleTestResult}
              onTestSaved={handleTestSaved}
            />
          </div>

          {/* Right: Test Results */}
          <div>
            <TestResults result={testResult} />
          </div>
        </div>

        {/* Bottom: Test Case List */}
        <div>
          <TestCaseList
            refreshTrigger={refreshTrigger}
            onTestRun={handleTestResult}
          />
        </div>
      </div>
    </div>
  )
}
