/**
 * prepare-wiki.mjs
 *
 * Replaces prepare-archive.mjs.
 *
 * Reads the LLM-wiki synthesis pages from the bkc-archive-wiki repo:
 *   topics/*.md  people/*.md  orgs/*.md  index.md  log.md
 *
 * Strips Quartz/Obsidian frontmatter and wikilinks, writes clean .txt
 * files to ./chunks/ ready for PDF generation.
 *
 * Run: node scripts/prepare-wiki.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')

const WIKI_ROOT = process.env.WIKI_PATH ?? '/Users/rijul/Documents/Code/bkc-archive-wiki'
const CHUNKS_DIR = join(ROOT, 'chunks')

mkdirSync(CHUNKS_DIR, { recursive: true })

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n?/, '')
}

function cleanMarkdown(content) {
  return content
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label ?? target)
    .replace(/^#+ /gm, '')
    .trim()
}

function readWikiPage(filePath, label) {
  if (!existsSync(filePath)) return null
  const raw = readFileSync(filePath, 'utf8')
  const clean = cleanMarkdown(stripFrontmatter(raw))
  if (!clean || clean.length < 50) return null
  return { label, content: clean, path: filePath }
}

function collectDir(dir, prefix) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const slug = basename(f, '.md')
      const label = `${prefix}/${slug}`
      return readWikiPage(join(dir, f), label)
    })
    .filter(Boolean)
}

const pages = [
  readWikiPage(join(WIKI_ROOT, 'index.md'), 'index'),
  readWikiPage(join(WIKI_ROOT, 'log.md'), 'log'),
  ...collectDir(join(WIKI_ROOT, 'topics'), 'topics'),
  ...collectDir(join(WIKI_ROOT, 'people'), 'people'),
  ...collectDir(join(WIKI_ROOT, 'orgs'), 'orgs'),
].filter(Boolean)

console.log(`Found ${pages.length} wiki synthesis pages in ${WIKI_ROOT}`)

for (const page of pages) {
  const slug = page.label.replace(/\//g, '--')
  const outPath = join(CHUNKS_DIR, `${slug}.txt`)
  const text = `${page.label}\n${'='.repeat(60)}\n\n${page.content}\n`
  writeFileSync(outPath, text, 'utf8')
  console.log(`  ${page.label}  (${page.content.length} chars)`)
}

console.log(`\nDone. ${pages.length} wiki pages written to ./chunks/`)
