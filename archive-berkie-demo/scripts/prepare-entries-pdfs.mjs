/**
 * prepare-entries-pdfs.mjs  (Track A)
 *
 * Replaces the year-grouped prepare-archive.mjs + generate-pdfs.mjs pair.
 *
 * Builds ONE PDF per wiki entry (topic / person / org / index) straight from
 * public/entries.json, shaped so LLM Engine's fixed RecursiveCharacterTextSplitter
 * (chunkSize 1000, chunkOverlap 200 — hard-coded in src/agents/helpers/rag.ts)
 * produces topically coherent chunks:
 *
 *   1. One topic per file  → every chunk is single-topic *by construction*,
 *      no matter where the splitter lands its boundaries.
 *   2. Topic label stamped on every item line → topic identity survives the
 *      lossy text → PDF → PDFLoader → re-split round-trip.
 *   3. Long tracking-token URLs stripped to clean canonical links → chunks
 *      aren't poisoned with query-string token soup. (The Slack card still
 *      cites the exact full URL from entries.json.)
 *   4. Dates, neighbors, and keywords inlined as plain text → these facets are
 *      at least embeddable, since metadata filtering isn't reachable via the
 *      PDF-only resource API.
 *
 * Output:
 *   ./chunks/<base>.txt   (inspectable intermediate)
 *   ./pdfs/<base>.pdf     (uploaded by upload-pdfs.mjs)
 *
 * where <base> matches setup.mjs's slug → wiki-URL convention:
 *   topic  → topics--<slug>     person → people--<slug>
 *   org    → orgs--<slug>       index  → index
 *
 * Run:  node scripts/prepare-entries-pdfs.mjs
 * Then: node setup.mjs  &&  node scripts/upload-pdfs.mjs
 */

import PDFDocument from 'pdfkit'
import { readFileSync, writeFileSync, createWriteStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')

const ENTRIES_PATH = process.env.ENTRIES_PATH ?? join(ROOT, 'public', 'entries.json')
const CHUNKS_DIR = join(ROOT, 'chunks')
const PDF_DIR = process.env.PDF_OUTPUT_DIR ?? join(ROOT, 'pdfs')

const KIND_LABEL = { topic: 'Topic', person: 'Person', org: 'Organization', index: 'Index' }
const SUBPATH = { topic: 'topics', person: 'people', org: 'orgs' }

// ── text helpers ─────────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// Drop query strings (tracking/sharing tokens) so they don't dominate a chunk.
function cleanUrl(u) {
  if (!u) return ''
  try {
    const x = new URL(u)
    return (x.origin + x.pathname).replace(/\/$/, '')
  } catch {
    return (u.split('?')[0] || u)
  }
}

function fileBase(slug, kind) {
  const sub = SUBPATH[kind]
  return sub ? `${sub}--${slug}` : slug // index / other → bare slug
}

// ── per-entry document text (chunk-optimized) ────────────────────────────────

function buildEntryText(slug, e) {
  const kind = e.l1?.kind ?? 'topic'
  const label = e.l1?.label ?? slug
  const stamp = `[${label}]` // repeated marker that survives PDF reflow

  const out = []

  // Header block — self-identifying, comfortably under one chunk.
  out.push(`=== ${KIND_LABEL[kind] ?? 'Entry'}: ${label} ===`)
  const meta = [`Type: ${KIND_LABEL[kind] ?? 'Entry'} in the BKC Archive Wiki`]
  if (e.l1?.count) meta.push(`Coverage: ${e.l1.count} archive items`)
  meta.push('Corpus span: 2014-2026')
  out.push(meta.join('. ') + '.')
  if (e.l1?.gloss) out.push(`Gloss: ${stripHtml(e.l1.gloss)}`)
  const neighbors = (e.l1?.neighbors ?? []).filter(Boolean)
  if (neighbors.length) out.push(`Related to: ${neighbors.join('; ')}`)
  const kw = (e.keywords ?? []).filter((w) => (w ?? '').length > 2)
  if (kw.length) out.push(`Search terms: ${kw.join(', ')}`)
  out.push('') // blank line → preferred \n\n split boundary

  // Synthesis (the topical payload).
  const synth = stripHtml(e.l2)
  if (synth) {
    out.push(`${stamp} Summary`)
    out.push(`${stamp} ${synth}`)
    out.push('')
  }

  // Curated items — each line carries the topic stamp + an embeddable date/domain/url.
  const items = e.l3 ?? []
  if (items.length) {
    out.push(`${stamp} Key items in the archive`)
    for (const it of items) {
      const parts = [`${stamp} "${stripHtml(it.t)}"`]
      if (it.d) parts.push(`- ${it.d}`)
      if (it.dom) parts.push(`. ${it.dom}`)
      const u = cleanUrl(it.url)
      if (u) parts.push(`. ${u}`)
      if (it.clinic) parts.push('. (Cyberlaw Clinic)')
      out.push(parts.join(' '))
    }
    out.push('')
  }

  const src = e.l2src || e.prov?.where || `${SUBPATH[kind] ?? ''}/${slug}`
  out.push(`Source: BKC Archive Wiki - ${src}`)
  out.push('')

  return out.join('\n')
}

// ── PDF rendering (mirrors generate-pdfs.mjs style) ──────────────────────────

function textToPdf(text, pdfPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' })
    const stream = createWriteStream(pdfPath)
    doc.pipe(stream)

    const lines = text.split('\n')

    // Title line
    doc.fontSize(15).font('Helvetica-Bold').text(lines[0] ?? '', { align: 'left' })
    doc.moveDown(0.4)
    doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke()
    doc.moveDown(0.4)

    doc.fontSize(10).font('Helvetica')
    for (const line of lines.slice(1)) {
      if (doc.y > 720) doc.addPage()
      const isHeader = /\] Summary$/.test(line) || /\] Key items/.test(line)
      if (isHeader) {
        doc.moveDown(0.2)
        doc.font('Helvetica-Bold').text(line, { lineGap: 2 })
        doc.font('Helvetica')
      } else {
        doc.text(line || ' ', { lineGap: 1 })
      }
    }

    doc.end()
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

// ── main ─────────────────────────────────────────────────────────────────────

mkdirSync(CHUNKS_DIR, { recursive: true })
mkdirSync(PDF_DIR, { recursive: true })

const entries = JSON.parse(readFileSync(ENTRIES_PATH, 'utf8'))
const slugs = Object.keys(entries).sort()
console.log(`Loaded ${slugs.length} entries from ${ENTRIES_PATH}\n`)

let count = 0
for (const slug of slugs) {
  const e = entries[slug]
  const kind = e.l1?.kind ?? 'topic'
  const base = fileBase(slug, kind)

  const text = buildEntryText(slug, e)
  writeFileSync(join(CHUNKS_DIR, `${base}.txt`), text, 'utf8')

  const pdfPath = join(PDF_DIR, `${base}.pdf`)
  await textToPdf(text, pdfPath)

  console.log(`  ${(KIND_LABEL[kind] ?? 'Entry').padEnd(12)} ${base}.pdf`)
  count++
}

console.log(`\nDone. ${count} topic-grouped PDFs in ./pdfs/ and intermediates in ./chunks/`)
console.log(`Next: node setup.mjs  &&  node scripts/upload-pdfs.mjs`)
