/**
 * prepare-archive.mjs
 *
 * Reads archive.json, strips HTML, filters workflow-only tags,
 * and groups items by year into chunked text files ready for PDF generation.
 *
 * Output: ./chunks/<year>.txt  (one file per year)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')

const ARCHIVE_PATH = process.env.ARCHIVE_PATH ?? join(ROOT, 'raw', 'archive.json')
const CHUNKS_DIR = join(ROOT, 'chunks')

// Tags that are newsletter/workflow channels, not topical descriptors
const WORKFLOW_TAGS = new Set([
  'community', 'orbit', 'buzz', 'events',
  'opportunities', 'bkc-happenings'
])

function stripHtml(s) {
  return (s ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
}

function formatItem(item) {
  const desc = stripHtml(item.description)
  const topicTags = (item.tags ?? []).filter(t => !WORKFLOW_TAGS.has(t))
  const date = item.date_published?.slice(0, 10) ?? 'unknown date'
  const lines = [`[${date}] ${item.title}`, `URL: ${item.url}`]
  if (desc) lines.push(`Note: ${desc}`)
  if (topicTags.length) lines.push(`Tags: ${topicTags.join(', ')}`)
  return lines.join('\n')
}

mkdirSync(CHUNKS_DIR, { recursive: true })

const parsed = JSON.parse(readFileSync(ARCHIVE_PATH, 'utf8'))
const raw = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
console.log(`Loaded ${raw.length} items from archive`)

// Group by year
const byYear = {}
for (const item of raw) {
  if (!item.title || !item.url) continue
  const year = item.date_published?.slice(0, 4) ?? 'unknown'
  if (!byYear[year]) byYear[year] = []
  byYear[year].push(item)
}

let totalItems = 0
for (const [year, items] of Object.entries(byYear).sort()) {
  const text = [
    `BKC Archive — ${year}`,
    `${items.length} items`,
    '='.repeat(60),
    '',
    ...items.map(formatItem).join('\n\n---\n\n').split('\n')
  ].join('\n')

  const outPath = join(CHUNKS_DIR, `${year}.txt`)
  writeFileSync(outPath, text, 'utf8')
  console.log(`  ${year}: ${items.length} items → ${outPath}`)
  totalItems += items.length
}

console.log(`\nDone. ${totalItems} items across ${Object.keys(byYear).length} year files in ./chunks/`)
