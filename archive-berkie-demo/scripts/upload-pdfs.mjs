/**
 * upload-pdfs.mjs
 *
 * Uploads each ./pdfs/<year>.pdf to its corresponding resource stub
 * in the conversation created by setup.mjs.
 *
 * Reads conversationId, jwt, and resourceMap from .setup-state.json.
 * Run after setup.mjs and generate-pdfs.mjs.
 *
 * Run: node scripts/upload-pdfs.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')

// ── load state ─────────────────────────────────────────────────────────────

const statePath = join(ROOT, '.setup-state.json')
if (!existsSync(statePath)) {
  console.error('ERROR: .setup-state.json not found. Run setup.mjs first.')
  process.exit(1)
}

const { jwt, conversationId, resourceMap } = JSON.parse(readFileSync(statePath, 'utf8'))

function loadEnv() {
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnv()

const BASE = (process.env.LLM_ENGINE_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/v1'
const PDF_DIR = process.env.PDF_OUTPUT_DIR ?? join(ROOT, 'pdfs')

// ── upload each PDF ────────────────────────────────────────────────────────

const pdfFiles = readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf')).sort()
console.log(`Found ${pdfFiles.length} PDFs to upload to conversation ${conversationId}\n`)

let uploaded = 0
let skipped = 0

for (const file of pdfFiles) {
  const slug = basename(file, '.pdf')
  const resource = resourceMap.find(r => r.slug === slug)

  if (!resource?.id) {
    console.warn(`  SKIP ${file} — no matching resource stub for slug "${slug}"`)
    console.warn(`        Available slugs: ${resourceMap.map(r => r.slug).join(', ')}`)
    skipped++
    continue
  }

  const pdfPath = join(PDF_DIR, file)
  const pdfBytes = readFileSync(pdfPath)

  const formData = new FormData()
  formData.append('pdf', new Blob([pdfBytes], { type: 'application/pdf' }), file)

  const res = await fetch(`${BASE}/resources/${conversationId}/${resource.id}/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData
  })

  if (res.status === 204) {
    console.log(`  ✓ ${file}  →  resource ${resource.id}`)
    uploaded++
  } else {
    const body = await res.text()
    console.error(`  ✗ ${file}  →  ${res.status}: ${body}`)
  }
}

console.log(`\nDone. ${uploaded} uploaded, ${skipped} skipped.`)
if (uploaded > 0) {
  console.log(`\nBerkie will now use these PDFs for RAG when answering in Slack.`)
  console.log(`LLM Engine indexes them into ChromaDB in the background — allow ~1 min before testing.`)
}
