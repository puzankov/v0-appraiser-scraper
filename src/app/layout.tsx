import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Florida Property Appraiser Scraper',
  description: 'Web scraping service for extracting property owner data from Florida county appraiser websites',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
