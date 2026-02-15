/**
 * Counties API endpoint
 * GET /api/counties - List all available counties
 */

import { NextResponse } from 'next/server'
import { loadAllCountyConfigs } from '@/lib/config/counties'
import { CountiesListResponse, CountySummary } from '@/types/api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/counties
 * List all configured counties
 */
export async function GET() {
  try {
    const configs = loadAllCountyConfigs()

    // Convert to summary format (hide sensitive config details)
    const counties: CountySummary[] = configs.map((config) => ({
      id: config.id,
      name: config.name,
      state: config.state,
      identifierTypes: config.identifierTypes,
      enabled: config.enabled,
    }))

    const response: CountiesListResponse = {
      counties,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[API] Failed to load counties:', error)

    return NextResponse.json(
      {
        error: {
          code: 'LOAD_COUNTIES_FAILED',
          message: 'Failed to load county configurations',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    )
  }
}
