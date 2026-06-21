/**
 * Test case list component
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TestCase, TestResult } from '@/types/test'
import { CountySummary } from '@/types/api'

type TestStatus = 'idle' | 'running' | 'passed' | 'failed'
type FilterMode = 'all' | 'passed' | 'failed'

function buildPropertyUrl(template: string, countyId: string, identifier: string): string {
  let id = identifier

  // County-specific ID transforms matching scraper logic
  if (countyId === 'duval') {
    id = identifier.replace(/-/g, '')
  } else if (countyId === 'miamidade') {
    id = identifier.replace(/\D/g, '')
  } else if (countyId === 'pasco') {
    // Reorder first 3 segments: "22-26-21-..." → "21-26-22-..." then strip non-numeric
    const parts = identifier.split('-')
    if (parts.length >= 3) {
      const reordered = [parts[2], parts[1], parts[0], ...parts.slice(3)]
      id = reordered.join('').replace(/\D/g, '')
    } else {
      id = identifier.replace(/\D/g, '')
    }
  }

  // Don't encode if {ID} appears after a # (hash fragment URLs: brevard, hillsborough, miami-dade)
  const hashIndex = template.indexOf('#')
  const idIndex = template.indexOf('{ID}')
  const inHash = hashIndex !== -1 && idIndex > hashIndex
  return template.replace('{ID}', inHash ? id : encodeURIComponent(id))
}

interface TestCaseListProps {
  refreshTrigger: number
  onTestRun: (result: any) => void
}

export function TestCaseList({ refreshTrigger, onTestRun }: TestCaseListProps) {
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [counties, setCounties] = useState<Record<string, CountySummary>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({})
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState<{ passed: number; failed: number } | null>(null)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterMode>('all')

  const loadTestCases = async () => {
    try {
      const response = await fetch('/api/test-cases')
      if (response.ok) {
        const data = await response.json()
        const sorted = (data.testCases || []).sort((a: TestCase, b: TestCase) => {
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })
        setTestCases(sorted)
      }
    } catch (error) {
      console.error('Failed to load test cases:', error)
    }
  }

  useEffect(() => {
    fetch('/api/counties')
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, CountySummary> = {}
        for (const c of data.counties || []) map[c.id] = c
        setCounties(map)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    loadTestCases()
  }, [refreshTrigger])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this test case?')) return

    try {
      const response = await fetch(`/api/test-cases/${id}`, { method: 'DELETE' })
      if (response.ok) {
        loadTestCases()
      } else {
        alert('Failed to delete test case')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Delete failed')
    }
  }

  const handleRun = async (id: string) => {
    setLoading(id)
    setTestStatuses((prev) => ({ ...prev, [id]: 'running' }))

    try {
      const response = await fetch(`/api/test-cases/${id}?run=true`)
      if (response.ok) {
        const result: TestResult = await response.json()
        setTestResults((prev) => ({ ...prev, [id]: result }))
        if (result.passed) {
          setTestStatuses((prev) => ({ ...prev, [id]: 'passed' }))
          setExpandedErrors((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        } else {
          setTestStatuses((prev) => ({ ...prev, [id]: 'failed' }))
          setExpandedErrors((prev) => new Set(prev).add(id))
        }
        onTestRun(result)
      } else {
        setTestStatuses((prev) => ({ ...prev, [id]: 'idle' }))
        alert('Failed to run test case')
      }
    } catch (error) {
      console.error('Run failed:', error)
      setTestStatuses((prev) => ({ ...prev, [id]: 'idle' }))
      alert('Run failed')
    } finally {
      setLoading(null)
    }
  }

  const handleRunAll = async () => {
    setRunningAll(true)
    setSummary(null)

    const initial: Record<string, TestStatus> = {}
    for (const tc of testCases) initial[tc.id] = 'idle'
    setTestStatuses(initial)
    setTestResults({})
    setExpandedErrors(new Set())

    let passed = 0
    let failed = 0

    const BATCH_SIZE = 3

    const runOne = async (testCase: TestCase) => {
      setTestStatuses((prev) => ({ ...prev, [testCase.id]: 'running' }))
      try {
        const response = await fetch(`/api/test-cases/${testCase.id}?run=true`)
        if (response.ok) {
          const result: TestResult = await response.json()
          setTestResults((prev) => ({ ...prev, [testCase.id]: result }))
          if (result.passed) {
            setTestStatuses((prev) => ({ ...prev, [testCase.id]: 'passed' }))
            passed++
          } else {
            setTestStatuses((prev) => ({ ...prev, [testCase.id]: 'failed' }))
            setExpandedErrors((prev) => new Set(prev).add(testCase.id))
            failed++
          }
        } else {
          setTestStatuses((prev) => ({ ...prev, [testCase.id]: 'failed' }))
          failed++
        }
      } catch {
        setTestStatuses((prev) => ({ ...prev, [testCase.id]: 'failed' }))
        failed++
      }
    }

    for (let i = 0; i < testCases.length; i += BATCH_SIZE) {
      await Promise.all(testCases.slice(i, i + BATCH_SIZE).map(runOne))
    }

    setSummary({ passed, failed })
    setRunningAll(false)
  }

  const handleUpdateExpected = async (id: string) => {
    const result = testResults[id]
    const testCase = testCases.find((tc) => tc.id === id)
    if (!result || !testCase) return

    const ownerAssertion = result.assertions.find((a) => a.field === 'ownerName')
    const addressAssertion = result.assertions.find((a) => a.field === 'mailingAddress')
    const newOwnerName = ownerAssertion?.actual || testCase.expectedOwnerName
    const newAddress = addressAssertion?.actual || testCase.expectedAddress

    setUpdatingIds((prev) => new Set(prev).add(id))

    try {
      const response = await fetch(`/api/test-cases/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testCase.name,
          countyId: testCase.countyId,
          identifierType: testCase.identifierType,
          identifier: testCase.identifier,
          expectedOwnerName: newOwnerName,
          expectedAddress: newAddress,
          description: testCase.description,
          tags: testCase.tags,
        }),
      })

      if (response.ok) {
        const { testCase: updated } = await response.json()
        setTestCases((prev) => prev.map((tc) => (tc.id === id ? updated : tc)))
        setTestStatuses((prev) => ({ ...prev, [id]: 'idle' }))
        setExpandedErrors((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setSummary((prev) =>
          prev ? { passed: prev.passed + 1, failed: prev.failed - 1 } : null
        )
      } else {
        alert('Failed to update test case')
      }
    } catch {
      alert('Failed to update test case')
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderStatusIcon = (id: string) => {
    const status = testStatuses[id]
    if (!status || status === 'idle') return null

    if (status === 'running') {
      return (
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )
    }

    if (status === 'passed') {
      return (
        <span className="text-green-600 text-lg leading-none flex-shrink-0" title="Passed">
          ✓
        </span>
      )
    }

    if (status === 'failed') {
      return (
        <button
          onClick={() => toggleExpanded(id)}
          className="text-red-600 text-lg leading-none flex-shrink-0 hover:text-red-800"
          title="Failed — click to toggle details"
        >
          ✗
        </button>
      )
    }

    return null
  }

  const renderErrorDetails = (id: string) => {
    if (!expandedErrors.has(id)) return null
    const result = testResults[id]
    if (!result) return null

    const isDataMismatch = result.scrapeResult.success && result.assertions.length > 0
    const isUpdating = updatingIds.has(id)

    return (
      <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm">
        {result.error && (
          <p className="text-red-800 font-medium mb-2">{result.error}</p>
        )}
        {result.assertions && result.assertions.length > 0 && (
          <div className="space-y-2">
            {result.assertions.map((assertion, i) => (
              <div key={i} className={assertion.passed ? 'opacity-50' : ''}>
                <div className="flex items-center gap-2">
                  <span className={assertion.passed ? 'text-green-600' : 'text-red-600'}>
                    {assertion.passed ? '✓' : '✗'}
                  </span>
                  <span className="font-medium text-gray-700">{assertion.field}</span>
                  {assertion.similarity !== undefined && (
                    <span className="text-gray-400 text-xs">
                      {Math.round(assertion.similarity * 100)}% match
                    </span>
                  )}
                </div>
                {!assertion.passed && (
                  <div className="ml-5 mt-1 space-y-1 font-mono text-xs">
                    <div>
                      <span className="text-gray-500">expected: </span>
                      <span className="text-gray-900">{assertion.expected || '(empty)'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">actual:   </span>
                      <span className="text-red-700">{assertion.actual || '(empty)'}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {isDataMismatch && (
          <div className="mt-3 pt-3 border-t border-red-200">
            <button
              onClick={() => handleUpdateExpected(id)}
              disabled={isUpdating}
              className="text-xs px-3 py-1.5 rounded bg-white border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUpdating ? 'Updating...' : 'Update expected values to current'}
            </button>
          </div>
        )}
      </div>
    )
  }

  const visibleTestCases = testCases.filter((tc) => {
    if (filter === 'passed') return testStatuses[tc.id] === 'passed'
    if (filter === 'failed') return testStatuses[tc.id] === 'failed'
    return true
  })

  return (
    <Card title="Saved Test Cases">
      <div className="mb-4 flex justify-between items-center gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Filter tabs */}
          <div className="flex rounded border border-gray-200 overflow-hidden text-xs">
            {(['all', 'passed', 'failed'] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                className={`px-3 py-1 capitalize transition-colors ${
                  filter === mode
                    ? mode === 'passed'
                      ? 'bg-green-100 text-green-700 font-medium'
                      : mode === 'failed'
                      ? 'bg-red-100 text-red-700 font-medium'
                      : 'bg-gray-100 text-gray-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-500">
            {visibleTestCases.length}/{testCases.length}
          </p>
          {summary && (
            <p className="text-sm">
              <span className="text-green-600 font-medium">{summary.passed} passed</span>
              <span className="text-gray-400 mx-1">·</span>
              <span className="text-red-600 font-medium">{summary.failed} failed</span>
            </p>
          )}
        </div>
        {testCases.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRunAll}
            disabled={runningAll}
          >
            {runningAll ? 'Running...' : 'Run All Tests'}
          </Button>
        )}
      </div>

      {testCases.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No test cases saved yet</p>
      ) : visibleTestCases.length === 0 ? (
        <p className="text-gray-400 text-center py-8 text-sm">No {filter} tests</p>
      ) : (
        <div className="space-y-3">
          {visibleTestCases.map((testCase) => {
            const county = counties[testCase.countyId]
            const propertyUrl = county?.propertyUrlTemplate
              ? buildPropertyUrl(county.propertyUrlTemplate, testCase.countyId, testCase.identifier)
              : null
            return (
              <div
                key={testCase.id}
                className={`p-4 border rounded transition-colors ${
                  testStatuses[testCase.id] === 'passed'
                    ? 'border-green-200 bg-green-50'
                    : testStatuses[testCase.id] === 'failed'
                    ? 'border-red-200 bg-red-50'
                    : testStatuses[testCase.id] === 'running'
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Top row: status icon + name + appraiser link + buttons */}
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3 min-w-0">
                    {renderStatusIcon(testCase.id)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium text-gray-900">{testCase.name}</h4>
                        {propertyUrl && (
                          <a
                            href={propertyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-1.5 py-0.5 rounded border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-colors"
                            title="Open property page on appraiser site"
                          >
                            ↗ property
                          </a>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {testCase.countyId} • {testCase.identifierType}: {testCase.identifier}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRun(testCase.id)}
                      disabled={loading === testCase.id || runningAll}
                    >
                      {loading === testCase.id ? 'Running...' : 'Run'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(testCase.id)}
                      disabled={runningAll}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Expected values — always visible */}
                <div className="mt-2 ml-8 text-xs text-gray-500 space-y-0.5">
                  <div>
                    <span className="text-gray-400">owner: </span>
                    <span className="text-gray-700">{testCase.expectedOwnerName}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">address: </span>
                    <span className="text-gray-700">{testCase.expectedAddress}</span>
                  </div>
                </div>

                {/* Test case ID */}
                <div className="mt-1.5 ml-8">
                  <span
                    className="text-xs text-gray-300 font-mono cursor-pointer hover:text-gray-500 transition-colors"
                    title="Click to copy file ID"
                    onClick={() => navigator.clipboard.writeText(testCase.id)}
                  >
                    {testCase.id}
                  </span>
                </div>

                {testCase.description && (
                  <p className="text-sm text-gray-500 mt-2 ml-8">{testCase.description}</p>
                )}
                {renderErrorDetails(testCase.id)}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
