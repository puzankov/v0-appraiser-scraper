/**
 * Home page
 */

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto py-12 px-4">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Florida Property Appraiser Scraper
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Web scraping service for extracting property owner data from Florida county appraiser websites
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/testing">
              <Button size="lg">Testing Console</Button>
            </Link>
            <a href="/api/scrape" target="_blank">
              <Button size="lg" variant="secondary">API Documentation</Button>
            </a>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card title="Flexible Architecture">
            <p className="text-gray-600">
              Modular design with county-specific scrapers that extend a base scraper class using the Template Method pattern.
            </p>
          </Card>
          <Card title="API-First Design">
            <p className="text-gray-600">
              RESTful API endpoints for programmatic access to property data across all configured Florida counties.
            </p>
          </Card>
          <Card title="Testing Console">
            <p className="text-gray-600">
              Integrated UI for testing scrapers, creating regression test cases, and monitoring scraper accuracy.
            </p>
          </Card>
        </div>

        {/* API Documentation */}
        <Card title="API Endpoints">
          <div className="space-y-6">
            {/* Scrape Endpoint */}
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded">
                  POST
                </span>
                <code className="text-sm font-mono text-gray-900">/api/scrape</code>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                Scrape property owner data from a Florida county appraiser website
              </p>
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                <pre className="text-sm">
{`curl -X POST http://localhost:3000/api/scrape \\
  -H "Content-Type: application/json" \\
  -d '{
    "countyId": "miami-dade",
    "identifierType": "parcelId",
    "identifier": "12345"
  }'`}
                </pre>
              </div>
            </div>

            {/* Counties Endpoint */}
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">
                  GET
                </span>
                <code className="text-sm font-mono text-gray-900">/api/counties</code>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                List all available counties with their supported identifier types
              </p>
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
                <pre className="text-sm">
{`curl http://localhost:3000/api/counties`}
                </pre>
              </div>
            </div>

            {/* Test Cases Endpoint */}
            <div>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">
                  GET
                </span>
                <code className="text-sm font-mono text-gray-900">/api/test-cases</code>
              </div>
              <p className="text-sm text-gray-600">
                List all saved test cases or run all tests with <code>?run=true</code>
              </p>
            </div>
          </div>
        </Card>

        {/* Response Format */}
        <Card title="Response Format" className="mt-6">
          <p className="text-sm text-gray-600 mb-3">
            Successful scrape response:
          </p>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
            <pre className="text-sm">
{`{
  "success": true,
  "data": {
    "ownerNames": ["JOHN DOE", "JANE DOE"],
    "mailingAddress": "123 Main St, Miami, FL 33101",
    "countyId": "miami-dade",
    "identifier": "12345",
    "identifierType": "parcelId",
    "scrapedAt": "2024-01-01T12:00:00.000Z"
  },
  "metadata": {
    "countyId": "miami-dade",
    "identifier": "12345",
    "identifierType": "parcelId",
    "startTime": "2024-01-01T12:00:00.000Z",
    "endTime": "2024-01-01T12:00:05.000Z",
    "duration": 5000
  }
}`}
            </pre>
          </div>
        </Card>

        {/* Footer */}
        <div className="text-center mt-12 text-gray-500 text-sm">
          <p>Built with Next.js, Puppeteer, and TypeScript</p>
          <p className="mt-1">Deployed on Vercel Serverless Functions</p>
        </div>
      </div>
    </div>
  )
}
