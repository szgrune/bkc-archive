/**
 * generate-pdfs.mjs
 *
 * Converts each ./chunks/<year>.txt into a PDF using pdfkit.
 * Output: ./pdfs/<year>.pdf
 *
 * Run after prepare-archive.mjs.
 */

import PDFDocument from 'pdfkit'
import { createWriteStream, readdirSync, readFileSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const CHUNKS_DIR = join(ROOT, 'chunks')
const PDF_DIR = process.env.PDF_OUTPUT_DIR ?? join(ROOT, 'pdfs')

mkdirSync(PDF_DIR, { recursive: true })

function textToPdf(textPath, pdfPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' })
    const stream = createWriteStream(pdfPath)
    doc.pipe(stream)

    const text = readFileSync(textPath, 'utf8')
    const lines = text.split('\n')

    // Title (first line)
    doc.fontSize(16).font('Helvetica-Bold').text(lines[0] ?? '', { align: 'left' })
    doc.fontSize(10).font('Helvetica').text(lines[1] ?? '', { align: 'left' })
    doc.moveDown(0.5)
    doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke()
    doc.moveDown(0.5)

    // Body
    doc.fontSize(9).font('Helvetica')
    for (const line of lines.slice(3)) {
      if (doc.y > 720) doc.addPage()
      if (line.startsWith('[20') || line.startsWith('[un')) {
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

const txtFiles = readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.txt')).sort()
console.log(`Generating ${txtFiles.length} PDFs...`)

for (const file of txtFiles) {
  const year = basename(file, '.txt')
  const pdfPath = join(PDF_DIR, `${year}.pdf`)
  await textToPdf(join(CHUNKS_DIR, file), pdfPath)
  console.log(`  ${year}.pdf`)
}

console.log(`\nDone. PDFs written to ./pdfs/`)
