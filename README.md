# JobForge Scraper Service

A dedicated microservice for scraping product data from various suppliers using Playwright. This service runs on Railway with Docker to provide browser automation capabilities that aren't available in Vercel's serverless environment.

## Why Railway?

- **Vercel limitation**: Vercel's serverless functions can't run Playwright (browser automation)
- **Railway solution**: Railway runs Docker containers that can include Playwright and Chromium
- **Authentication support**: Can log into supplier sites to get account-specific pricing

## Features

- Scrapes product data from multiple suppliers:
  - Richelieu
  - Home Depot
  - Lowe's
  - Amazon
- Supports authentication for account-specific pricing
- Returns structured product data including:
  - Name, SKU, Price, MSRP
  - Description, Brand, Images
  - Category path

## Deployment

1. Push this repository to GitHub
2. In Railway:
   - Create a new service from GitHub repo
   - Set environment variables:
     - `RAILWAY_SCRAPER_SECRET`: Your secret token
     - `PORT`: 3001 (or let Railway assign)

## API Usage

### Health Check
```
GET /health
```

### Scrape Product
```
POST /api/scrape
Headers:
  Authorization: Bearer YOUR_SECRET_TOKEN
Body:
{
  "url": "https://www.richelieu.com/product/12345",
  "credentials": {
    "username": "account@example.com",
    "password": "password",
    "supplierName": "Richelieu"
  }
}
```

## Local Development

```bash
# Install dependencies
npm install

# Run locally
npm start

# Or with Docker
docker build -t jobforge-scraper .
docker run -p 3001:3001 jobforge-scraper
```

## Architecture

This service is designed to work with the main JobForge application:

1. JobForge (on Vercel) receives a product URL from user
2. JobForge sends scraping request to this service (on Railway)
3. This service uses Playwright to scrape the product page
4. Returns structured data back to JobForge
5. JobForge saves the data to its database

## Security

- Requires authentication token in Authorization header
- Token is validated against `RAILWAY_SCRAPER_SECRET` environment variable
- Supports encrypted supplier credentials for authenticated scraping