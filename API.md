# Florida Property Appraiser Scraper API Documentation

## Base URL

```
# Local Development
http://localhost:3434/api

# Production
https://v0-appraiser-scraper.vercel.app/api
```

## Authentication

All API requests require an API key to be sent in the request headers.

### Header

```
X-API-Key: your_api_key_here
```

Or as a query parameter:

```
?apiKey=your_api_key_here
```

### Setup

Add your API key to `.env.local`:

```bash
API_KEY=your_secret_api_key_here
```

## Endpoints

### 1. Scrape Property Data

Scrape property owner and mailing address data from a Florida county property appraiser website.

**Endpoint:** `POST /api/scrape`

**Authentication:** Required

**Request Body:**

```json
{
  "countyId": "miami-dade",
  "identifierType": "parcelId",
  "identifier": "30-2024-000-0241"
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `countyId` | string | Yes | County identifier (e.g., "miami-dade", "broward", "hillsborough") |
| `identifierType` | string | Yes | Type of property identifier. Currently only "parcelId" is supported |
| `identifier` | string | Yes | The property identifier (parcel ID, folio number, etc.) |

**Response (Success):**

```json
{
  "success": true,
  "data": {
    "ownerNames": [
      "SMITH JOHN DOE\nSMITH JANE DOE"
    ],
    "mailingAddress": "123 MAIN STREET\nMIAMI FL 33101",
    "countyId": "miami-dade",
    "identifier": "30-2024-000-0241",
    "identifierType": "parcelId",
    "scrapedAt": "2026-02-17T12:34:56.789Z"
  },
  "metadata": {
    "countyId": "miami-dade",
    "identifier": "30-2024-000-0241",
    "identifierType": "parcelId",
    "startTime": "2026-02-17T12:34:50.123Z",
    "endTime": "2026-02-17T12:34:56.789Z",
    "duration": 6666
  }
}
```

**Response (Error):**

```json
{
  "success": false,
  "error": {
    "code": "NO_RESULTS_FOUND",
    "message": "No results found for identifier '30-2024-000-0241' in miami-dade",
    "details": null
  },
  "metadata": {
    "countyId": "miami-dade",
    "identifier": "30-2024-000-0241",
    "identifierType": "parcelId",
    "startTime": "2026-02-17T12:34:50.123Z",
    "endTime": "2026-02-17T12:34:56.789Z",
    "duration": 6666
  }
}
```

**Error Codes:**

| Code | Description |
|------|-------------|
| `COUNTY_NOT_FOUND` | The specified county is not configured or enabled |
| `VALIDATION_ERROR` | Invalid request parameters (missing required fields, invalid format, etc.) |
| `NAVIGATION_FAILED` | Failed to navigate to the property page |
| `NO_RESULTS_FOUND` | No property found with the given identifier |
| `EXTRACTION_FAILED` | Failed to extract data from the page |
| `TIMEOUT` | Request exceeded the timeout limit |
| `UNKNOWN_ERROR` | An unexpected error occurred |

**cURL Example:**

```bash
curl -X POST https://v0-appraiser-scraper.vercel.app/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{
    "countyId": "miami-dade",
    "identifierType": "parcelId",
    "identifier": "30-2024-000-0241"
  }'
```

**Node.js Example:**

```javascript
const response = await fetch('https://v0-appraiser-scraper.vercel.app/api/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your_api_key_here'
  },
  body: JSON.stringify({
    countyId: 'miami-dade',
    identifierType: 'parcelId',
    identifier: '30-2024-000-0241'
  })
});

const result = await response.json();
console.log(result);
```

**Python Example:**

```python
import requests

response = requests.post(
    'https://v0-appraiser-scraper.vercel.app/api/scrape',
    headers={
        'Content-Type': 'application/json',
        'X-API-Key': 'your_api_key_here'
    },
    json={
        'countyId': 'miami-dade',
        'identifierType': 'parcelId',
        'identifier': '30-2024-000-0241'
    }
)

result = response.json()
print(result)
```

---

### 2. List Available Counties

Get a list of all available Florida counties supported by the scraper.

**Endpoint:** `GET /api/counties`

**Authentication:** Optional (but recommended)

**Response:**

```json
{
  "counties": [
    {
      "id": "alachua",
      "name": "Alachua County",
      "state": "FL",
      "identifierTypes": ["parcelId"],
      "enabled": true
    },
    {
      "id": "miami-dade",
      "name": "Miami-Dade County",
      "state": "FL",
      "identifierTypes": ["parcelId"],
      "enabled": true
    }
  ]
}
```

**cURL Example:**

```bash
curl https://v0-appraiser-scraper.vercel.app/api/counties \
  -H "X-API-Key: your_api_key_here"
```

---

## Supported Counties

The following Florida counties are currently supported:

| County ID | County Name | Identifier Types |
|-----------|-------------|------------------|
| `alachua` | Alachua County | parcelId |
| `brevard` | Brevard County | parcelId |
| `broward` | Broward County | parcelId |
| `charlotte` | Charlotte County | parcelId |
| `citrus` | Citrus County | parcelId |
| `clay` | Clay County | parcelId |
| `duval` | Duval County | parcelId |
| `escambia` | Escambia County | parcelId |
| `flagler` | Flagler County | parcelId |
| `hillsborough` | Hillsborough County | parcelId |
| `lake` | Lake County | parcelId |
| `lee` | Lee County | parcelId |
| `marion` | Marion County | parcelId |
| `miami-dade` | Miami-Dade County | parcelId |
| `palm-beach` | Palm Beach County | parcelId |
| `pasco` | Pasco County | parcelId |
| `pinellas` | Pinellas County | parcelId |
| `polk` | Polk County | parcelId |
| `santa-rosa` | Santa Rosa County | parcelId |
| `sarasota` | Sarasota County | parcelId |
| `volusia` | Volusia County | parcelId |

## Rate Limiting

To ensure fair usage and system stability:

- Maximum 60 requests per minute per API key
- Maximum 1000 requests per hour per API key
- Each scraping request may take 5-30 seconds depending on the county website

If you exceed these limits, you'll receive a `429 Too Many Requests` response.

## Timeouts

- Default timeout: 30 seconds per request
- Some counties may take longer if the website is slow
- Requests that exceed the timeout will return a `TIMEOUT` error

## Best Practices

1. **Cache Results**: Property data doesn't change frequently. Cache results for at least 24 hours to reduce API calls.

2. **Handle Errors Gracefully**: Always check the `success` field and handle errors appropriately.

3. **Retry Logic**: Implement exponential backoff for retries on timeout or temporary errors.

4. **Validate Input**: Ensure parcel IDs are in the correct format for each county before making requests.

5. **Monitor Usage**: Track your API usage to stay within rate limits.

## Response Times

Typical response times by county:

- **Fast** (2-5 seconds): Counties with modern APIs or simple HTML
  - Palm Beach, Pinellas, Sarasota

- **Medium** (5-15 seconds): Counties with standard websites
  - Miami-Dade, Broward, Hillsborough, Polk

- **Slow** (15-30 seconds): Counties with JavaScript SPAs or complex pages
  - Brevard, Santa Rosa, Volusia

## Error Handling Example

```javascript
async function scrapeProperty(countyId, identifier) {
  try {
    const response = await fetch('https://v0-appraiser-scraper.vercel.app/api/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.API_KEY
      },
      body: JSON.stringify({
        countyId,
        identifierType: 'parcelId',
        identifier
      })
    });

    const result = await response.json();

    if (!result.success) {
      switch (result.error.code) {
        case 'NO_RESULTS_FOUND':
          console.log('Property not found');
          break;
        case 'TIMEOUT':
          console.log('Request timed out, retry later');
          break;
        case 'COUNTY_NOT_FOUND':
          console.log('County not supported');
          break;
        default:
          console.log('Error:', result.error.message);
      }
      return null;
    }

    return result.data;
  } catch (error) {
    console.error('Network error:', error);
    return null;
  }
}
```

## Support

For issues, questions, or feature requests, please contact the development team or check the project repository.

## Changelog

### Version 1.0.0 (2026-02-17)
- Initial release
- Support for 21 Florida counties
- API key authentication
- Comprehensive error handling
