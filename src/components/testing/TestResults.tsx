/**
 * Test results display component
 */

'use client'

import React from 'react'
import { Card } from '@/components/ui/Card'
import { TestResult } from '@/types/test'

interface TestResultsProps {
  result: TestResult | null
}

export function TestResults({ result }: TestResultsProps) {
  if (!result) {
    return (
      <Card title="Test Results">
        <p className="text-gray-500">Run a test to see results here</p>
      </Card>
    )
  }

  const { passed, assertions, scrapeResult, duration, error } = result

  return (
    <Card title="Test Results">
      {/* Overall Status */}
      <div className={`mb-4 p-4 rounded ${passed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <h3 className={`text-lg font-semibold ${passed ? 'text-green-800' : 'text-red-800'}`}>
          {passed ? 'Test Passed ✓' : 'Test Failed ✗'}
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Duration: {duration}ms
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded">
          <h4 className="font-semibold text-red-800 mb-2">Error</h4>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Scrape Status */}
      <div className="mb-4">
        <h4 className="font-semibold text-gray-900 mb-2">Scrape Status</h4>
        <p className={`text-sm ${scrapeResult.success ? 'text-green-600' : 'text-red-600'}`}>
          {scrapeResult.success ? 'Scraping succeeded' : 'Scraping failed'}
        </p>
        {scrapeResult.error && (
          <p className="text-sm text-red-600 mt-1">
            {scrapeResult.error.code}: {scrapeResult.error.message}
          </p>
        )}
      </div>

      {/* Assertions */}
      {assertions.length > 0 && (
        <div className="mb-4">
          <h4 className="font-semibold text-gray-900 mb-2">Assertions</h4>
          <div className="space-y-3">
            {assertions.map((assertion, index) => (
              <div
                key={index}
                className={`p-3 rounded border ${
                  assertion.passed
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">
                    {assertion.field}
                  </span>
                  <span className={`text-sm ${assertion.passed ? 'text-green-600' : 'text-red-600'}`}>
                    {assertion.passed ? 'Pass' : 'Fail'}
                    {assertion.similarity !== undefined && ` (${Math.round(assertion.similarity * 100)}%)`}
                  </span>
                </div>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-gray-600">Expected: </span>
                    <span className="text-gray-900">{assertion.expected}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Actual: </span>
                    <span className="text-gray-900">{assertion.actual}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scraped Data */}
      {scrapeResult.success && scrapeResult.data && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-2">Scraped Data</h4>
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            <pre className="text-sm text-gray-800 whitespace-pre-wrap">
              {JSON.stringify(scrapeResult.data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </Card>
  )
}
