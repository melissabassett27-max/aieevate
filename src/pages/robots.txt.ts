import type { APIRoute } from 'astro'

export const GET: APIRoute = ({ site }) => {
  const sitemapLine = site ? `Sitemap: ${new URL('sitemap-index.xml', site).href}\n` : ''
  return new Response(`User-agent: *\nAllow: /\n${sitemapLine}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
