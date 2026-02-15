/** @type {import('next').NextConfig} */
const nextConfig = {
  // Externalize Puppeteer packages for Vercel serverless functions
  experimental: {
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  },
  // Increase payload limit for scraping results
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
}

module.exports = nextConfig
