/**
 * serve.mjs — static file server for the Berkie Nextspace demo
 *
 * Serves public/ on http://localhost:8080
 * Also proxies /api/* → http://localhost:3000/v1/* (for CORS-free LLM Engine access)
 *
 * Run: node serve.mjs
 */

import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dir, 'public')
const PORT = 8080
const LLM_ENGINE = 'http://localhost:3000/v1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

createServer(async (req, res) => {
  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS); res.end(); return
  }

  // ── Proxy /api/* → LLM Engine ───────────────────────────────────────────────
  if (req.url.startsWith('/api/')) {
    const target = LLM_ENGINE + req.url.slice(4)   // strip /api prefix
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = chunks.length ? Buffer.concat(chunks) : undefined
        const upstream = await fetch(target, {
          method: req.method,
          headers: {
            'Content-Type': req.headers['content-type'] ?? 'application/json',
            ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
          },
          body: body?.length ? body : undefined
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
          ...CORS_HEADERS
        })
        res.end(text)
      } catch (e) {
        res.writeHead(502, CORS_HEADERS)
        res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }))
      }
    })
    return
  }

  // ── Static files ─────────────────────────────────────────────────────────────
  let urlPath = req.url.split('?')[0]
  if (urlPath === '/') urlPath = '/index.html'
  const filePath = join(PUBLIC, urlPath)

  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('Forbidden'); return
  }
  if (!existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return
  }

  const type = MIME[extname(filePath)] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, ...CORS_HEADERS })
  res.end(readFileSync(filePath))

}).listen(PORT, () => {
  console.log(`Berkie demo  →  http://localhost:${PORT}`)
  console.log(`LLM Engine proxy  →  /api/*  →  ${LLM_ENGINE}/*`)
})
