/**
 * County configuration loader
 */

import fs from 'fs'
import path from 'path'
import { CountyConfig } from '@/types/scraper'
import { createCountyNotFoundError, createCountyDisabledError } from '../scrapers/utils/errors'

// Cache for county configurations
let configCache: Record<string, CountyConfig> | null = null

/**
 * Load all county configurations from JSON file
 */
function loadCountyConfigurations(): Record<string, CountyConfig> {
  if (configCache) {
    return configCache
  }

  try {
    const configPath = path.join(process.cwd(), 'config', 'counties.json')
    const configFile = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(configFile)

    configCache = config.counties || {}
    return configCache
  } catch (error) {
    console.error('Failed to load county configurations:', error)
    throw new Error(`Failed to load county configurations: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get configuration for a specific county
 */
export function loadCountyConfig(countyId: string, checkEnabled: boolean = true): CountyConfig {
  const configs = loadCountyConfigurations()
  const config = configs[countyId]

  if (!config) {
    throw createCountyNotFoundError(countyId)
  }

  if (checkEnabled && !config.enabled) {
    throw createCountyDisabledError(countyId)
  }

  return config
}

/**
 * Get all county configurations
 */
export function loadAllCountyConfigs(): CountyConfig[] {
  const configs = loadCountyConfigurations()
  return Object.values(configs)
}

/**
 * Get enabled counties only
 */
export function loadEnabledCountyConfigs(): CountyConfig[] {
  return loadAllCountyConfigs().filter((config) => config.enabled)
}

/**
 * Check if a county exists and is enabled
 */
export function isCountyEnabled(countyId: string): boolean {
  try {
    const config = loadCountyConfig(countyId, false)
    return config.enabled
  } catch {
    return false
  }
}

/**
 * Clear configuration cache (useful for testing)
 */
export function clearConfigCache(): void {
  configCache = null
}
