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
      <Card title="Results">
        <p className="text-gray-500">Run a scraper to see results here</p>
      </Card>
    )
  }

  const { passed, assertions, scrapeResult, duration, error } = result
  const isTestMode = assertions.length > 0

  return (
    <Card title={isTestMode ? 'Test Results' : 'Scraped Data'}>
      {/* Overall Status - only show for test mode */}
      {isTestMode && (
        <div className={`mb-4 p-4 rounded ${passed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <h3 className={`text-lg font-semibold ${passed ? 'text-green-800' : 'text-red-800'}`}>
            {passed ? 'Test Passed ✓' : 'Test Failed ✗'}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Duration: {duration}ms
          </p>
        </div>
      )}

      {/* Preview mode status */}
      {!isTestMode && scrapeResult.success && (
        <div className="mb-4 p-4 rounded bg-blue-50 border border-blue-200">
          <h3 className="text-lg font-semibold text-blue-800">
            Data Retrieved ✓
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Duration: {duration}ms
          </p>
        </div>
      )}

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

      {/* Assertions - only in test mode */}
      {isTestMode && assertions.length > 0 && (
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

      {/* Scraped Data - prominent in preview mode, collapsed in test mode */}
      {scrapeResult.success && scrapeResult.data && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-2">
            {isTestMode ? 'Raw Scraped Data' : 'Property Data'}
          </h4>

          {/* Show formatted data for preview mode */}
          {!isTestMode && (
            <div className="space-y-3 mb-4">
              <div className="p-3 bg-white rounded border border-gray-200">
                <div className="text-sm font-medium text-gray-600 mb-1">Owner Name(s)</div>
                <div className="text-gray-900">
                  {scrapeResult.data.ownerNames.map((name, i) => (
                    <div key={i} className="font-medium">{name}</div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-white rounded border border-gray-200">
                <div className="text-sm font-medium text-gray-600 mb-1">Mailing Address</div>
                <div className="text-gray-900 whitespace-pre-line">
                  {typeof scrapeResult.data.mailingAddress === 'string'
                    ? scrapeResult.data.mailingAddress
                    : scrapeResult.data.mailingAddress.raw}
                </div>
              </div>
            </div>
          )}

          {/* Raw JSON for test mode or details */}
          <details className={isTestMode ? '' : 'mt-4'}>
            <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900 mb-2">
              {isTestMode ? 'View Raw JSON' : 'View as JSON'}
            </summary>
            <div className="bg-gray-50 p-3 rounded border border-gray-200">
              <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                {JSON.stringify(scrapeResult.data, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      )}

      {/* Debug JSON - for easy copying and sharing */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-gray-900 hover:text-primary-600 mb-2">
            🔍 Debug JSON (Copy to share with developer)
          </summary>
          <div className="bg-gray-900 p-4 rounded border border-gray-700">
            <pre className="text-xs text-green-400 whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify({
                request: {
                  countyId: scrapeResult.metadata.countyId,
                  identifierType: scrapeResult.metadata.identifierType,
                  identifier: scrapeResult.metadata.identifier,
                },
                scraped: {
                  success: scrapeResult.success,
                  data: scrapeResult.data || null,
                  error: scrapeResult.error || null,
                },
                expected: isTestMode ? {
                  ownerName: assertions.find(a => a.field === 'ownerName')?.expected || null,
                  mailingAddress: assertions.find(a => a.field === 'mailingAddress')?.expected || null,
                } : null,
                comparison: isTestMode ? {
                  passed: passed,
                  assertions: assertions.map(a => ({
                    field: a.field,
                    passed: a.passed,
                    similarity: a.similarity,
                    expected: a.expected,
                    actual: a.actual,
                  })),
                } : null,
                metadata: {
                  duration: duration,
                  executedAt: result.executedAt,
                  testCaseId: result.testCaseId,
                  testCaseName: result.testCaseName,
                },
              }, null, 2)}
            </pre>
            <button
              onClick={() => {
                const debugData = JSON.stringify({
                  request: {
                    countyId: scrapeResult.metadata.countyId,
                    identifierType: scrapeResult.metadata.identifierType,
                    identifier: scrapeResult.metadata.identifier,
                  },
                  scraped: {
                    success: scrapeResult.success,
                    data: scrapeResult.data || null,
                    error: scrapeResult.error || null,
                  },
                  expected: isTestMode ? {
                    ownerName: assertions.find(a => a.field === 'ownerName')?.expected || null,
                    mailingAddress: assertions.find(a => a.field === 'mailingAddress')?.expected || null,
                  } : null,
                  comparison: isTestMode ? {
                    passed: passed,
                    assertions: assertions,
                  } : null,
                  metadata: {
                    duration: duration,
                    executedAt: result.executedAt,
                  },
                }, null, 2)
                navigator.clipboard.writeText(debugData)
                alert('Debug JSON copied to clipboard!')
              }}
              className="mt-2 px-3 py-1 bg-primary-600 text-white text-xs rounded hover:bg-primary-700 transition-colors"
            >
              📋 Copy to Clipboard
            </button>
          </div>
        </details>
      </div>
    </Card>
  )
}
