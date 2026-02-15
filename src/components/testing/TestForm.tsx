/**
 * Test form component for creating and running tests
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Card } from '@/components/ui/Card'
import { TestResult } from '@/types/test'
import { CountySummary } from '@/types/api'

interface TestFormProps {
  onTestResult: (result: TestResult) => void
  onTestSaved: () => void
}

export function TestForm({ onTestResult, onTestSaved }: TestFormProps) {
  const [counties, setCounties] = useState<CountySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    countyId: '',
    identifierType: 'parcelId',
    identifier: '',
    expectedOwnerName: '',
    expectedAddress: '',
    description: '',
  })

  // Load counties on mount
  useEffect(() => {
    fetch('/api/counties')
      .then((res) => res.json())
      .then((data) => {
        setCounties(data.counties.filter((c: CountySummary) => c.enabled))
        if (data.counties.length > 0) {
          setFormData((prev) => ({
            ...prev,
            countyId: data.counties[0].id,
          }))
        }
      })
      .catch((error) => console.error('Failed to load counties:', error))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Auto-generate name from county and identifier
      const testCaseData = {
        ...formData,
        name: `${formData.countyId}_${formData.identifier}`,
      }

      // Create test case
      const createResponse = await fetch('/api/test-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCaseData),
      })

      if (!createResponse.ok) {
        throw new Error('Failed to create test case')
      }

      const { testCase } = await createResponse.json()

      // Run test case
      const runResponse = await fetch(`/api/test-cases/${testCase.id}?run=true`)
      if (!runResponse.ok) {
        throw new Error('Failed to run test case')
      }

      const result = await runResponse.json()
      onTestResult(result)
    } catch (error) {
      console.error('Test execution failed:', error)
      alert(`Test failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setLoading(true)

    try {
      // Auto-generate name from county and identifier
      const testCaseData = {
        ...formData,
        name: `${formData.countyId}_${formData.identifier}`,
      }

      const response = await fetch('/api/test-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testCaseData),
      })

      if (!response.ok) {
        throw new Error('Failed to save test case')
      }

      alert('Test case saved successfully!')
      onTestSaved()

      // Reset form
      setFormData({
        countyId: counties[0]?.id || '',
        identifierType: 'parcelId',
        identifier: '',
        expectedOwnerName: '',
        expectedAddress: '',
        description: '',
      })
    } catch (error) {
      console.error('Save failed:', error)
      alert(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const selectedCounty = counties.find((c) => c.id === formData.countyId)
  const identifierTypeOptions =
    selectedCounty?.identifierTypes.map((type) => ({
      value: type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
    })) || []

  return (
    <Card title="Test Scraper">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="County"
          value={formData.countyId}
          onChange={(e) => setFormData({ ...formData, countyId: e.target.value })}
          options={counties.map((c) => ({ value: c.id, label: c.name }))}
          required
        />

        {identifierTypeOptions.length > 0 && (
          <Select
            label="Identifier Type"
            value={formData.identifierType}
            onChange={(e) => setFormData({ ...formData, identifierType: e.target.value })}
            options={identifierTypeOptions}
            required
          />
        )}

        <Input
          label="Identifier"
          value={formData.identifier}
          onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
          placeholder="Enter property identifier"
          required
        />

        <Input
          label="Expected Owner Name"
          value={formData.expectedOwnerName}
          onChange={(e) => setFormData({ ...formData, expectedOwnerName: e.target.value })}
          placeholder="Expected owner name"
          required
        />

        <Input
          label="Expected Address"
          value={formData.expectedAddress}
          onChange={(e) => setFormData({ ...formData, expectedAddress: e.target.value })}
          placeholder="Expected mailing address"
          required
        />

        <Input
          label="Description (Optional)"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Additional notes about this test case"
        />

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? 'Running...' : 'Run Test'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleSave} disabled={loading}>
            Save Test Case
          </Button>
        </div>
      </form>
    </Card>
  )
}
