/**
 * validate-chunks.mjs — replicates llm_engine's addPDFToVectorStore chunking
 * (PDF text → RecursiveCharacterTextSplitter chunkSize 1000 / overlap 200)
 * and reports topical coherence. Trivial extraction fragments (<50 chars) and
 * the index catalog (a deliberate cross-topic page) are reported separately.
 */
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { createRequire } from 'module'
import { readdirSync, readFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')
const pdfText = async (buf) => (await new PDFParse({ data: buf }).getText()).text ?? ''

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const PDF_DIR = join(ROOT, 'pdfs')
const entries = JSON.parse(readFileSync(join(ROOT, 'public', 'entries.json'), 'utf8'))
const allLabels = Object.values(entries).map((e) => e.l1?.label).filter(Boolean)
const labelFor = (base) => entries[base.includes('--') ? base.split('--')[1] : base]?.l1?.label ?? null

const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 })
const files = readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf') && f !== 'index.pdf').sort()

let real = 0, trivial = 0, ownStamp = 0, foreignItem = 0, neighborLink = 0, maxLen = 0
for (const f of files) {
  const own = labelFor(basename(f, '.pdf'))
  const docs = await splitter.createDocuments([await pdfText(readFileSync(join(PDF_DIR, f)))])
  for (const d of docs) {
    const c = d.pageContent
    if (c.trim().length < 50) { trivial++; continue }   // extraction artifacts
    real++
    maxLen = Math.max(maxLen, c.length)
    if (own && c.includes(`[${own}]`)) ownStamp++                       // self-identifying
    // true contamination: a STAMPED ITEM RECORD belonging to another topic
    if (allLabels.some((l) => l !== own && c.includes(`[${l}] "`))) foreignItem++
    // benign, intentional cross-link: a neighbor named in prose/"Related to"
    if (allLabels.some((l) => l !== own && c.includes(l) && !c.includes(`[${l}] "`))) neighborLink++
  }
}
console.log(`Topic/person/org PDFs:        ${files.length}  (index catalog excluded)`)
console.log(`Real chunks (>=50 chars):     ${real}   [+${trivial} trivial fragments ignored]`)
console.log(`Largest chunk (chars):        ${maxLen}`)
console.log(`Carry own topic stamp:        ${ownStamp}/${real}  (${((ownStamp/real)*100).toFixed(0)}%)`)
console.log(`Foreign item contamination:   ${foreignItem}/${real}  <-- the old failure mode`)
console.log(`Intentional neighbor links:   ${neighborLink}/${real}  (topical adjacency, by design)`)
