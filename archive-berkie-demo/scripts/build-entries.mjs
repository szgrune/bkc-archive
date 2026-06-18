/**
 * build-entries.mjs
 *
 * Reads all bkc-archive-wiki pages + archive.json and produces public/entries.json:
 * the full L1-L5 dataset for the Nextspace frontend.
 *
 * Run: node scripts/build-entries.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')

const WIKI_ROOT = process.env.WIKI_PATH ?? '/Users/rijul/Documents/Code/bkc-archive-wiki'
const ARCHIVE_PATH = process.env.ARCHIVE_PATH ?? join(WIKI_ROOT, 'raw', 'archive.json')
const OUT_DIR = join(ROOT, 'public')
const WIKI_BASE = 'https://szgrune.github.io/bkc-archive-wiki'

mkdirSync(OUT_DIR, { recursive: true })

// ── 1. Archive.json → id lookup map ──────────────────────────────────────────

const archiveRaw = JSON.parse(readFileSync(ARCHIVE_PATH, 'utf8'))
const archiveItems = Array.isArray(archiveRaw) ? archiveRaw : (archiveRaw.items ?? [])
const archiveById = new Map()
for (const item of archiveItems) {
  if (item.id != null) archiveById.set(String(item.id), item)
}
console.log(`Loaded ${archiveById.size} archive items`)

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

// ── 2. index.md → catalog map ─────────────────────────────────────────────────

function parseIndexMd(content) {
  const map = new Map()
  let kind = 'topic'
  for (const line of content.split('\n')) {
    if (/^## Topics/.test(line))  { kind = 'topic';  continue }
    if (/^## People/.test(line))  { kind = 'person'; continue }
    if (/^## Org/.test(line))     { kind = 'org';    continue }
    if (/^## /.test(line))        { kind = 'other';  continue }
    const m = line.match(/- \[\[([^\]|]+?)(?:\|([^\]]+))?\]\] — (.*?) \((\d+)\)/)
    if (m) {
      const [, slug, label, gloss, countStr] = m
      map.set(slug, { kind, label: label ?? slug, gloss: gloss.trim(), count: parseInt(countStr) })
    }
  }
  return map
}

const indexContent = readFileSync(join(WIKI_ROOT, 'index.md'), 'utf8')
const catalogMap = parseIndexMd(indexContent)
console.log(`Parsed ${catalogMap.size} catalog entries from index.md`)

// ── 3. Markdown parsing helpers ───────────────────────────────────────────────

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return {}
  const out = {}
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf(':')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
    }
    out[key] = val
  }
  return out
}

function proseToHtml(text) {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target.replace(/-/g, ' '))
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .trim()
}

function parseItemLine(line) {
  // [[12345678-slug|Title]] — 2025-10-01 · domain.com — optional note
  // domain part is optional (org pages omit it)
  const m = line.match(/\[\[(\d+)-[^\]|]*(?:\|([^\]]+))?\]\] — (\d{4}-\d{2}-\d{2})(?:\s+[·\xb7]\s+([^\s——\n]+))?(?: [——] (.*))?/)
  if (!m) return null
  const [, id, title, date, domRaw, note] = m
  const archived = archiveById.get(id)
  const dom = domRaw ?? domainOf(archived?.url ?? '')
  return {
    id,
    t: title ?? archived?.title ?? id,
    d: date,
    dom,
    note: note?.trim() ?? '',
    clinic: /cyberlaw clinic/i.test(note ?? ''),
    url: archived?.url ?? null
  }
}

function parseWikiPage(slug, filePath) {
  const content = readFileSync(filePath, 'utf8')
  const fm = parseFrontmatter(content)
  const body = content.replace(/^---[\s\S]*?---\n?/, '').trim()
  const sections = body.split(/^## /m)

  // L2: prose block before the first ## section, minus the # heading
  const prose = proseToHtml(sections[0].replace(/^# [^\n]+\n/, '').trim())

  // L3 items — section heading varies by page type
  const itemsSection = sections.find(s => /^Key items|^Representative items|^Items/.test(s))
  const items = []
  if (itemsSection) {
    for (const line of itemsSection.split('\n')) {
      const item = parseItemLine(line)
      if (item) items.push(item)
    }
  }

  // Related slugs
  const relSection = sections.find(s => /^Related/.test(s))
  const related = []
  if (relSection) {
    for (const m of relSection.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) related.push(m[1])
  }

  return { fm, prose, items, related }
}

// ── 4. Per-type helpers ───────────────────────────────────────────────────────

function tagFor(kind) {
  return kind === 'topic' ? 'p-coral' : kind === 'person' ? 'p-purple' : kind === 'org' ? 'p-teal' : 'p-amber'
}
function tagLabelFor(kind, title) {
  return kind === 'topic' ? `Topic · ${title}` : kind === 'person' ? `Person · ${title}` : kind === 'org' ? `Organization · ${title}` : `Index · ${title}`
}
function subpathFor(kind) {
  return kind === 'topic' ? 'topics' : kind === 'person' ? 'people' : kind === 'org' ? 'orgs' : ''
}

function buildKeywords(slug, fm, catalog) {
  const words = new Set()
  const addPhrase = s => { for (const w of s.toLowerCase().split(/\W+/)) if (w.length >= 3) words.add(w) }
  addPhrase(slug.replace(/-/g, ' '))
  if (catalog?.label) addPhrase(catalog.label)
  if (catalog?.gloss) addPhrase(catalog.gloss)
  if (fm.title) addPhrase(String(fm.title))
  const related = Array.isArray(fm.related) ? fm.related : []
  for (const r of related) addPhrase(r.replace(/-/g, ' '))
  return Array.from(words)
}

// ── 5. Build one entry ────────────────────────────────────────────────────────

function buildEntry(slug, filePath, defaultKind) {
  const catalog = catalogMap.get(slug)
  const { fm, prose, items, related } = parseWikiPage(slug, filePath)
  const kind = fm.type ?? defaultKind
  const title = fm.title ?? catalog?.label ?? slug
  const count = fm.item_count != null ? parseInt(fm.item_count) : (catalog?.count ?? items.length)
  const relatedArr = Array.isArray(fm.related) ? fm.related : related
  const neighbors = relatedArr
    .map(r => catalogMap.get(r)?.label ?? r.replace(/-/g, ' '))
    .filter(Boolean).slice(0, 4)
  const subpath = subpathFor(kind)
  const wikiUrl = `${WIKI_BASE}/${subpath}/${slug}`

  const l1 = {
    kind,
    label: catalog?.label ?? title,
    gloss: catalog?.gloss ?? '',
    count,
    neighbors
  }

  const l2 = prose
  const l2src = `${subpath}/${slug} · synthesis maintained by the LLM`

  const l3 = items.slice(0, 6).map(i => ({
    t: i.t, d: i.d, dom: i.dom,
    ...(i.url ? { url: i.url } : {}),
    ...(i.clinic ? { clinic: true } : {})
  }))

  const firstWithUrl = items.find(i => i.url)
  const l4 = firstWithUrl ? {
    t: firstWithUrl.t,
    dom: firstWithUrl.dom,
    d: firstWithUrl.d,
    tags: '',
    url: firstWithUrl.url
  } : {
    t: `${title} — BKC Archive Wiki`,
    dom: 'szgrune.github.io',
    d: new Date().toISOString().slice(0, 10),
    tags: 'wiki',
    url: wikiUrl
  }

  const l5 = {
    json: JSON.stringify({
      slug,
      type: kind,
      title,
      item_count: count,
      corpus_slice: '2025',
      related: relatedArr.slice(0, 4),
      wiki_url: wikiUrl,
      source_of_truth: 'raw/archive.json (immutable)'
    }, null, 2),
    note: 'Generated metadata layer — consumed by Berkie and downstream pipelines. The wiki page is the L2 synthesis; this is the machine representation beneath it.'
  }

  const conf = kind === 'topic' ? 0.87 : kind === 'person' ? 0.82 : 0.80

  return {
    slug,
    tag: tagFor(kind),
    tagLabel: tagLabelFor(kind, title),
    keywords: buildKeywords(slug, fm, catalog),
    l1, l2, l2src, l3, l4, l5,
    prov: {
      where: `BKC Archive Wiki · ${subpath}/${slug}.md`,
      who: 'LLM synthesis over curated feed'
    },
    conf
  }
}

// ── 6. Process all directories ────────────────────────────────────────────────

const entries = {}

function collectDir(dir, kind) {
  if (!existsSync(dir)) { console.warn(`  WARN: dir not found: ${dir}`); return }
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const slug = basename(f, '.md')
    try {
      entries[slug] = buildEntry(slug, join(dir, f), kind)
      const e = entries[slug]
      console.log(`  ${kind.padEnd(6)} ${slug.padEnd(45)} items=${e.l3.length} kw=${e.keywords.length}`)
    } catch (err) {
      console.warn(`  WARN: ${kind}/${slug} — ${err.message}`)
    }
  }
}

collectDir(join(WIKI_ROOT, 'topics'), 'topic')
collectDir(join(WIKI_ROOT, 'people'), 'person')
collectDir(join(WIKI_ROOT, 'orgs'), 'org')

// Special entries: index and log
entries['index'] = {
  slug: 'index',
  tag: 'p-amber',
  tagLabel: 'Index · the catalog itself',
  keywords: ['index', 'catalog', 'overview', 'all', 'topics', 'people', 'orgs', '2025', 'everything', 'whole', 'shape', 'structural', 'power', 'techlash'],
  l1: { kind: 'index', label: 'Index Catalog', gloss: 'the apex — every topic, person, org, by category', count: 737, neighbors: ['Timeline 2025', 'Sources by domain', 'Feed tags'] },
  l2: 'The archive\'s 2025 prototype slice is read by the LLM as a maturing techlash: a year in which complaint hardens into a <b>structural-power critique</b>. The most concentrated threads are surveillance, platform antitrust, and AI governance\'s state-vs-federal tug-of-war; the archive\'s distinctive note is its <b>global lens</b> — digital colonialism and Global-South reporting that US-centric collections miss. The catalog itself is the most concise representation: one line per subject, a count, and a path down.',
  l2src: 'index.md + timeline/2025 · synthesis maintained by the LLM',
  l3: [
    { t: 'AI Governance & Regulation — the state-vs-federal regulatory tug-of-war', d: 'topic', dom: '12 items' },
    { t: 'Digital Colonialism & the Global South — the archive\'s distinctive global lens', d: 'topic', dom: '13 items' },
    { t: 'Platform Power & Antitrust — concentration, the cloud oligopoly', d: 'topic', dom: '11 items' }
  ],
  l4: { t: 'Index Catalog — BKC Archive Wiki', dom: 'szgrune.github.io', d: '2026-06-12', tags: 'index', url: 'https://szgrune.github.io/bkc-archive-wiki/' },
  l5: { json: JSON.stringify({ scope: 'prototype slice = 2025', items_filed: 737, corpus_total: 6925, years: '2014–2026', domains: 2063, generated: ['sources/_domains', 'timeline/_counts', 'raw/feed-tags'], source_of_truth: 'raw/archive.json (immutable)' }, null, 2), note: 'The reference layer: 2,063 domains and per-month counts over the full 6,925-item corpus, all generated from the immutable archive.json beneath the wiki.' },
  prov: { where: 'BKC Archive Wiki · index.md', who: 'LLM synthesis; counts generated' },
  conf: 0.93
}
console.log(`  index  index                                            (special)`)

// ── 7. Write output ───────────────────────────────────────────────────────────

const outPath = join(OUT_DIR, 'entries.json')
writeFileSync(outPath, JSON.stringify(entries, null, 2))
console.log(`\nWrote ${Object.keys(entries).length} entries → public/entries.json`)
