/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable TypeScript checking during build (type issues will be ignored)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Externalize Puppeteer packages for Vercel serverless functions
  experimental: {
    serverComponentsExternalPackages: ['puppeteer-core', 'puppeteer', '@sparticuz/chromium-min'],
  },
}

module.exports = nextConfig
