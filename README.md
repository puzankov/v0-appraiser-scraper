# Florida Property Appraiser Scraper

A web scraping service for extracting property owner data from Florida county appraiser websites. Built with Next.js 14, Puppeteer, and TypeScript, optimized for deployment on Vercel serverless functions.

## Features

- **Flexible Architecture**: Modular design with county-specific scrapers extending a base scraper class
- **API-First Design**: RESTful API endpoints for programmatic access to property data
- **Testing Console**: Integrated UI for testing scrapers and managing regression test cases
- **Type-Safe**: Built with TypeScript for enhanced developer experience
- **Serverless Ready**: Optimized for Vercel deployment with @sparticuz/chromium

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Runtime**: Node.js on Vercel serverless
- **Browser Automation**: Puppeteer with @sparticuz/chromium
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Validation**: Zod

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Chrome/Chromium (for local development)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd v0-appraiser-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env.local
```

4. Configure your API key in `.env.local`:
```bash
API_KEY=your_secret_api_key_here
```

Generate a secure API key:
```bash
# On Linux/Mac:
openssl rand -base64 32

# Or use any secure random string generator
```

5. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── scrape/route.ts       # Main scraping endpoint
│   │   ├── counties/route.ts     # Counties list endpoint
│   │   └── test-cases/           # Test case CRUD endpoints
│   ├── testing/page.tsx          # Testing UI
│   └── page.tsx                  # Home page
├── lib/
│   ├── scrapers/
│   │   ├── base/
│   │   │   ├── BaseScraper.ts    # Abstract base class
│   │   │   └── ScraperFactory.ts # Factory pattern
│   │   ├── counties/             # County-specific scrapers
│   │   └── utils/                # Utilities (browser, errors, validators)
│   ├── testing/
│   │   ├── TestRunner.ts         # Test execution engine
│   │   └── storage.ts            # Test case storage
│   └── config/
│       └── counties.ts           # Configuration loader
├── components/
│   ├── ui/                       # Reusable UI components
│   └── testing/                  # Testing page components
└── types/                        # TypeScript definitions

config/
└── counties.json                 # County configuration

test-cases/                       # Saved test cases
```

## API Documentation

📖 **[Complete API Documentation](./API.md)**

### Authentication

All API requests require authentication via API key. Include your API key in requests:

**Header (Recommended):**
```bash
X-API-Key: your_api_key_here
```

**Query Parameter:**
```bash
?apiKey=your_api_key_here
```

### POST /api/scrape

Scrape property data from a county appraiser website.

**Request:**
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{
    "countyId": "miami-dade",
    "identifierType": "parcelId",
    "identifier": "12345"
  }'
```

**Request Body:**
```json
{
  "countyId": "miami-dade",
  "identifierType": "parcelId",
  "identifier": "12345"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "ownerNames": ["JOHN DOE"],
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
}
```

### GET /api/counties

List all configured counties.

**Response:**
```json
{
  "counties": [
    {
      "id": "miami-dade",
      "name": "Miami-Dade County",
      "state": "FL",
      "identifierTypes": ["parcelId", "folio"],
      "enabled": true
    }
  ]
}
```

### Test Cases Endpoints

- `GET /api/test-cases` - List all test cases
- `POST /api/test-cases` - Create a new test case
- `GET /api/test-cases/:id` - Get specific test case
- `PUT /api/test-cases/:id` - Update test case
- `DELETE /api/test-cases/:id` - Delete test case
- `GET /api/test-cases/:id?run=true` - Run a specific test
- `GET /api/test-cases?run=true` - Run all tests

## Adding a New County Scraper

1. **Add county configuration** to `config/counties.json`:
```json
{
  "your-county": {
    "id": "your-county",
    "name": "Your County",
    "state": "FL",
    "appraiserUrl": "https://...",
    "searchUrl": "https://...",
    "identifierTypes": ["parcelId"],
    "scraperModule": "your-county",
    "selectors": {
      "searchInput": "#search",
      "searchButton": "#submit",
      "ownerName": ".owner",
      "mailingAddress": ".address"
    },
    "waitForSelector": ".results",
    "timeout": 30000,
    "enabled": true
  }
}
```

2. **Create scraper class** at `src/lib/scrapers/counties/your-county.ts`:
```typescript
import { Page } from 'puppeteer-core'
import { BaseScraper } from '../base/BaseScraper'
import { ScrapeRequest, PropertyOwnerData } from '@/types/scraper'

export default class YourCountyScraper extends BaseScraper {
  protected async performSearch(page: Page, request: ScrapeRequest): Promise<void> {
    // Implement county-specific search logic
    await this.typeIntoField(page, this.config.selectors.searchInput!, request.identifier)
    await this.clickButton(page, this.config.selectors.searchButton!)
  }

  protected async extractPropertyData(
    page: Page,
    request: ScrapeRequest
  ): Promise<PropertyOwnerData> {
    // Implement county-specific data extraction
    const ownerName = await this.extractText(page, this.config.selectors.ownerName!)
    const mailingAddress = await this.extractText(page, this.config.selectors.mailingAddress!)

    return {
      ownerNames: ownerName ? [ownerName] : [],
      mailingAddress: mailingAddress || '',
      countyId: this.config.id,
      identifier: request.identifier,
      identifierType: request.identifierType,
      scrapedAt: new Date().toISOString(),
    }
  }
}
```

3. **Test the scraper** using the Testing Console at `/testing`

4. **Create test cases** for regression testing

## Testing Workflow

1. Navigate to `/testing`
2. Select county and enter property identifier
3. Fill in expected owner name and address
4. Click "Run Test" to execute and validate
5. Click "Save Test Case" to save for regression testing
6. Use "Run All Tests" to validate all scrapers

## Deployment

### Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

3. Set environment variables in Vercel dashboard if needed

### Configuration Notes

- Vercel functions have 60-second timeout (configured in `vercel.json`)
- Memory set to 3008MB for browser automation
- Puppeteer uses @sparticuz/chromium in production

## Development

### Type Checking
```bash
npm run type-check
```

### Linting
```bash
npm run lint
```

### Build
```bash
npm run build
```

## Architecture Patterns

### Template Method Pattern
`BaseScraper` defines the scraping algorithm structure:
1. Setup browser
2. Navigate to search page
3. Perform search (county-specific)
4. Wait for results
5. Extract data (county-specific)
6. Validate and return

### Factory Pattern
`ScraperFactory` creates and caches county-specific scraper instances.

### Strategy Pattern
Each county scraper is a strategy for extracting data from that county's website.

## Troubleshooting

### Local Chrome Not Found
Set `PUPPETEER_EXECUTABLE_PATH` in `.env.local`:
```bash
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
```

### Timeout Errors
Increase timeout in county config:
```json
{
  "timeout": 60000
}
```

### Selector Not Found
Use browser DevTools to inspect the county website and update selectors in `config/counties.json`.

## Contributing

1. Create a new branch for your county scraper
2. Follow the "Adding a New County Scraper" guide
3. Create test cases
4. Submit a pull request

## License

MIT

## Support

For issues and questions, please open a GitHub issue.
