import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSitemapUrl } from '../src/commands/sitemaps.ts'
import { CliError } from '../src/config.ts'

test('absolute URL is passed through unchanged regardless of site type', () => {
  const abs = 'https://example.com/sitemap.xml'
  assert.equal(resolveSitemapUrl(abs, 'https://example.com/'), abs)
  assert.equal(resolveSitemapUrl(abs, 'sc-domain:example.com'), abs)
})

test('relative path is resolved against a URL-prefix property', () => {
  assert.equal(
    resolveSitemapUrl('/sitemap.xml', 'https://example.com/'),
    'https://example.com/sitemap.xml',
  )
  assert.equal(
    resolveSitemapUrl('news-sitemap.xml', 'https://example.com/'),
    'https://example.com/news-sitemap.xml',
  )
})

test('relative path against a sc-domain: property throws CliError', () => {
  assert.throws(
    () => resolveSitemapUrl('sitemap.xml', 'sc-domain:example.com'),
    (e: unknown) => e instanceof CliError && e.message.includes('must be absolute'),
  )
})

test('site URL without trailing slash still resolves correctly', () => {
  assert.equal(
    resolveSitemapUrl('/sitemap.xml', 'https://example.com'),
    'https://example.com/sitemap.xml',
  )
})
