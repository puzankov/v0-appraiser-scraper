/**
 * Test case list component
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TestCase } from '@/types/test'

interface TestCaseListProps {
  refreshTrigger: number
  onTestRun: (result: any) => void
}

export function TestCaseList({ refreshTrigger, onTestRun }: TestCaseListProps) {
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [loading, setLoading] = useState(false)
  const [runningAll, setRunningAll] = useState(false)

  const loadTestCases = async () => {
    try {
      const response = await fetch('/api/test-cases')
      if (response.ok) {
        const data = await response.json()
        setTestCases(data.testCases || [])
      }
    } catch (error) {
      console.error('Failed to load test cases:', error)
    }
  }

  useEffect(() => {
    loadTestCases()
  }, [refreshTrigger])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this test case?')) {
      return
    }

    try {
      const response = await fetch(`/api/test-cases/${id}`, {
        method: 'DELETE',
      })

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
    setLoading(true)

    try {
      const response = await fetch(`/api/test-cases/${id}?run=true`)
      if (response.ok) {
        const result = await response.json()
        onTestRun(result)
      } else {
        alert('Failed to run test case')
      }
    } catch (error) {
      console.error('Run failed:', error)
      alert('Run failed')
    } finally {
      setLoading(false)
    }
  }

  const handleRunAll = async () => {
    setRunningAll(true)

    try {
      const response = await fetch('/api/test-cases?run=true')
      if (response.ok) {
        const batchResult = await response.json()
        alert(
          `Batch test completed:\n${batchResult.passedTests} passed, ${batchResult.failedTests} failed`
        )
      } else {
        alert('Failed to run all tests')
      }
    } catch (error) {
      console.error('Run all failed:', error)
      alert('Run all failed')
    } finally {
      setRunningAll(false)
    }
  }

  return (
    <Card title="Saved Test Cases">
      <div className="mb-4 flex justify-between items-center">
        <p className="text-sm text-gray-600">
          {testCases.length} test case{testCases.length !== 1 ? 's' : ''}
        </p>
        {testCases.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRunAll}
            disabled={runningAll}
          >
            {runningAll ? 'Running All...' : 'Run All Tests'}
          </Button>
        )}
      </div>

      {testCases.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No test cases saved yet</p>
      ) : (
        <div className="space-y-3">
          {testCases.map((testCase) => (
            <div
              key={testCase.id}
              className="p-4 border border-gray-200 rounded hover:border-gray-300 transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-medium text-gray-900">{testCase.name}</h4>
                  <p className="text-sm text-gray-600">
                    {testCase.countyId} • {testCase.identifierType}: {testCase.identifier}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRun(testCase.id)}
                    disabled={loading}
                  >
                    Run
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDelete(testCase.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {testCase.description && (
                <p className="text-sm text-gray-500 mt-2">{testCase.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
