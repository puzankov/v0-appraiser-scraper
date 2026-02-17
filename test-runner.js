#!/usr/bin/env node
/**
 * CLI Test Runner
 * Run all test cases from the command line
 *
 * Usage:
 *   node test-runner.js              # Run all tests
 *   node test-runner.js --county=miami-dade  # Run tests for specific county
 *   node test-runner.js --verbose    # Show detailed output
 */

const fs = require('fs');
const path = require('path');

// Load .env file manually
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=:#]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
}
loadEnv();

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  county: null,
  verbose: args.includes('--verbose') || args.includes('-v'),
};

// Parse --county flag
const countyArg = args.find(arg => arg.startsWith('--county='));
if (countyArg) {
  options.county = countyArg.split('=')[1];
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function loadTestCases() {
  const testCasesDir = path.join(__dirname, 'test-cases');
  const files = fs.readdirSync(testCasesDir).filter(f => f.endsWith('.json') && f !== '.gitkeep');

  const testCases = files.map(file => {
    const content = fs.readFileSync(path.join(testCasesDir, file), 'utf8');
    return JSON.parse(content);
  });

  // Filter by county if specified
  if (options.county) {
    return testCases.filter(tc => tc.countyId === options.county);
  }

  return testCases;
}

async function runTests() {
  log('\n┌─────────────────────────────────────────┐', colors.bold);
  log('│   Florida Property Scraper Test Suite  │', colors.bold);
  log('└─────────────────────────────────────────┘\n', colors.bold);

  const testCases = loadTestCases();

  if (testCases.length === 0) {
    log('No test cases found!', colors.yellow);
    if (options.county) {
      log(`No tests found for county: ${options.county}`, colors.yellow);
    }
    process.exit(1);
  }

  log(`Found ${testCases.length} test case(s)`, colors.blue);
  if (options.county) {
    log(`Filtering by county: ${options.county}`, colors.blue);
  }
  log('');

  const results = {
    total: testCases.length,
    passed: 0,
    failed: 0,
    errors: [],
  };

  const startTime = Date.now();

  // Make API calls to run tests
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const num = `[${i + 1}/${testCases.length}]`;

    process.stdout.write(`${colors.gray}${num}${colors.reset} ${testCase.name} (${testCase.countyId}) ... `);

    try {
      // Call the scrape API
      const response = await fetch('http://localhost:3434/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.API_KEY || '',
        },
        body: JSON.stringify({
          countyId: testCase.countyId,
          identifierType: testCase.identifierType,
          identifier: testCase.identifier,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        log('FAIL', colors.red);
        results.failed++;
        results.errors.push({
          testCase: testCase.name,
          error: result.error?.message || 'Scrape failed',
        });

        if (options.verbose) {
          log(`  Error: ${result.error?.message}`, colors.red);
          if (result.error?.details) {
            log(`  Details: ${JSON.stringify(result.error.details)}`, colors.gray);
          }
        }
      } else {
        // Check assertions
        const actualOwner = result.data.ownerNames.join(', ');
        const actualAddress = typeof result.data.mailingAddress === 'string'
          ? result.data.mailingAddress
          : result.data.mailingAddress.raw;

        const ownerMatch = normalizeText(actualOwner).includes(normalizeText(testCase.expectedOwnerName)) ||
                          normalizeText(testCase.expectedOwnerName).includes(normalizeText(actualOwner));

        const addressMatch = normalizeText(actualAddress).includes(normalizeText(testCase.expectedAddress).slice(0, 20));

        if (ownerMatch && addressMatch) {
          log('PASS', colors.green);
          results.passed++;
        } else {
          log('FAIL (mismatch)', colors.yellow);
          results.failed++;
          results.errors.push({
            testCase: testCase.name,
            error: 'Data mismatch',
            expected: { owner: testCase.expectedOwnerName, address: testCase.expectedAddress },
            actual: { owner: actualOwner, address: actualAddress },
          });
        }

        if (options.verbose) {
          log(`  Owner: ${actualOwner}`, colors.gray);
          log(`  Address: ${actualAddress}`, colors.gray);
          log(`  Duration: ${result.metadata.duration}ms`, colors.gray);
        }
      }
    } catch (error) {
      log('ERROR', colors.red);
      results.failed++;
      results.errors.push({
        testCase: testCase.name,
        error: error.message,
      });

      if (options.verbose) {
        log(`  ${error.message}`, colors.red);
      }
    }
  }

  const duration = Date.now() - startTime;

  // Summary
  log('\n────────────────────────────────────────', colors.bold);
  log('Test Summary', colors.bold);
  log('────────────────────────────────────────', colors.bold);
  log(`Total:   ${results.total}`);
  log(`Passed:  ${results.passed}`, results.passed > 0 ? colors.green : '');
  log(`Failed:  ${results.failed}`, results.failed > 0 ? colors.red : '');
  log(`Duration: ${(duration / 1000).toFixed(2)}s`);
  log('');

  // Show errors
  if (results.errors.length > 0) {
    log('Failed Tests:', colors.red + colors.bold);
    results.errors.forEach((err, i) => {
      log(`\n${i + 1}. ${err.testCase}`, colors.red);
      log(`   Error: ${err.error}`, colors.gray);

      if (err.expected && err.actual) {
        log(`   Expected owner: ${err.expected.owner}`, colors.gray);
        log(`   Actual owner:   ${err.actual.owner}`, colors.gray);
        log(`   Expected addr:  ${err.expected.address.slice(0, 50)}...`, colors.gray);
        log(`   Actual addr:    ${err.actual.address.slice(0, 50)}...`, colors.gray);
      }
    });
    log('');
  }

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

function normalizeText(text) {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Check if dev server is running
async function checkDevServer() {
  try {
    const response = await fetch('http://localhost:3434/api/counties');
    if (!response.ok) throw new Error('Server not responding');
  } catch (error) {
    log('Error: Dev server is not running on http://localhost:3434', colors.red);
    log('Please start the dev server first: npm run dev', colors.yellow);
    process.exit(1);
  }
}

// Main execution
(async () => {
  await checkDevServer();
  await runTests();
})();
