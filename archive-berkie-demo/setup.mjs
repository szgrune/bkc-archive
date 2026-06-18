/**
 * setup.mjs
 *
 * Bootstraps the Berkie demo against a running LLM Engine instance:
 *   1. Authenticates and gets a JWT
 *   2. Creates a Topic ("BKC Archive")
 *   3. Creates a Conversation with the chatbot agent + Slack adapter
 *      and stubs one resource per year PDF (2014–2026)
 *   4. Writes CONVERSATION_ID to .env so upload-pdfs.mjs can find it
 *
 * Prerequisites:
 *   - LLM Engine running:  cd llm_engine && yarn run dev
 *   - ChromaDB running:    chroma run --host 0.0.0.0 --port 8000
 *   - .env copied from .env.example and filled in
 *   - yarn install (for pdfkit)
 *
 * Run: node setup.mjs
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── load .env manually (no dotenv dependency) ─────────────────────────────

function loadEnv() {
  const envPath = join(__dir, '.env')
  if (!existsSync(envPath)) {
    console.error('ERROR: .env not found. Copy .env.example → .env and fill it in.')
    process.exit(1)
  }
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
const USERNAME = process.env.LLM_ENGINE_USERNAME
const PASSWORD = process.env.LLM_ENGINE_PASSWORD
const PLATFORM = process.env.LLM_PLATFORM ?? 'bedrock'
const MODEL = process.env.LLM_MODEL ?? 'anthropic.claude-sonnet-4-6-20251001-v1:0'
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_ID
const SLACK_WORKSPACE = process.env.SLACK_WORKSPACE
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const SLACK_BOT_NAME = process.env.SLACK_BOT_NAME ?? 'Berkie'

// ── helpers ────────────────────────────────────────────────────────────────

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body != null ? JSON.stringify(body) : undefined
  })

  const text = await res.text()
  if (!res.ok) {
    console.error(`\nAPI ERROR  ${method} ${path}  →  ${res.status}`)
    console.error(text)
    console.error('\nVerify the exact field names against http://localhost:3000/v1/docs')
    process.exit(1)
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ── 1. authenticate ────────────────────────────────────────────────────────

console.log('Authenticating...')
const auth = await api('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
const jwt = auth?.tokens?.access?.token
if (!jwt) {
  console.error('Unexpected auth response shape:', JSON.stringify(auth, null, 2))
  process.exit(1)
}
console.log('✓ authenticated')

// ── 2. create topic ────────────────────────────────────────────────────────

console.log('\nCreating topic...')
const topic = await api('POST', '/topics', {
  name: 'BKC Archive',
  private: false,
  archivable: false,
  archiveEmail: '',
  votingAllowed: false,
  conversationCreationAllowed: false
}, jwt)
const topicId = topic?.id ?? topic?._id
if (!topicId) {
  console.error('Unexpected topic response shape:', JSON.stringify(topic, null, 2))
  process.exit(1)
}
console.log(`✓ topic created: ${topicId}`)

// ── 3. build resource stubs from wiki PDF files ───────────────────────────

const PDF_DIR = process.env.PDF_OUTPUT_DIR ?? join(__dir, 'pdfs')
const WIKI_BASE = 'https://szgrune.github.io/bkc-archive-wiki'

function pdfSlugToWikiUrl(slug) {
  if (slug === 'index') return `${WIKI_BASE}/`
  if (slug === 'log') return `${WIKI_BASE}/log`
  const parts = slug.split('--')
  return `${WIKI_BASE}/${parts.join('/')}`
}

function pdfSlugToTitle(slug) {
  const name = slug.replace(/--/g, ' / ').replace(/-/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const pdfFiles = readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf')).sort()
const resourceStubs = pdfFiles.map(f => {
  const slug = basename(f, '.pdf')
  return {
    title: `BKC Wiki — ${pdfSlugToTitle(slug)}`,
    category: 'required',
    url: pdfSlugToWikiUrl(slug),
    description: `LLM-synthesized wiki page: ${slug.replace(/--/g, ' › ')}`,
    source: 'speaker',
    participantVisible: false,
    _slug: slug
  }
})

// ── 4. create conversation with chatbot agent + Slack adapter ─────────────

console.log('\nCreating conversation...')

// NOTE: If you see a 400 error here, open http://localhost:3000/v1/docs and
// check the exact field names for agentTypes[].properties and adapters[].
const conversation = await api('POST', '/conversations', {
  name: 'Berkie — BKC Archive Demo',
  topicId,
  enableDMs: [],
  resources: resourceStubs,
  agentTypes: [
    {
      name: 'eventAssistant',
      properties: {
        llmPlatform: PLATFORM,
        llmModel: MODEL,
        systemPrompt: `You are Berkie, the discovery assistant for the Berkman Klein Center archive.

Your knowledge comes from BKC's curated link feed (2014–2026): ~6,900 publications, events, blog posts, and community items across internet policy, AI governance, privacy, democracy, and digital rights.

When answering:
- Cite specific items by title and URL whenever possible
- Surface connections across people, events, publications, and time periods
- If a topic isn't covered in the archive, say so explicitly
- Keep responses concise and scannable
- Prefer concrete citations over general claims

You are an assistant, not an authority. The human keeps interpretive control.`
      }
    }
  ],
  adapters: SLACK_CHANNEL && SLACK_BOT_TOKEN ? [
    {
      type: 'slack',
      config: {
        channel: SLACK_CHANNEL,
        workspace: SLACK_WORKSPACE,
        botToken: SLACK_BOT_TOKEN,
        botName: SLACK_BOT_NAME
      }
    }
  ] : []
}, jwt)

const conversationId = conversation?.id ?? conversation?._id
if (!conversationId) {
  console.error('Unexpected conversation response shape:', JSON.stringify(conversation, null, 2))
  process.exit(1)
}
console.log(`✓ conversation created: ${conversationId}`)

// ── 5. extract resource IDs for PDF upload ─────────────────────────────────

const resources = conversation?.resources ?? []
console.log(`✓ ${resources.length} resource stubs created`)

const resourceMap = resources.map((r, i) => ({
  id: r.id ?? r._id,
  title: r.title,
  slug: resourceStubs[i]?._slug ?? ''
}))

// ── 6. persist state for upload-pdfs.mjs ──────────────────────────────────

const stateFile = join(__dir, '.setup-state.json')
writeFileSync(stateFile, JSON.stringify({
  jwt,
  topicId,
  conversationId,
  resourceMap
}, null, 2))

// Also append CONVERSATION_ID to .env for reference
const envPath = join(__dir, '.env')
const envContent = readFileSync(envPath, 'utf8')
if (!envContent.includes('CONVERSATION_ID=')) {
  appendFileSync(envPath, `\nCONVERSATION_ID=${conversationId}\n`)
} else {
  writeFileSync(envPath, envContent.replace(/CONVERSATION_ID=.*/, `CONVERSATION_ID=${conversationId}`))
}

console.log(`\nState saved to .setup-state.json`)
console.log(`\n${'─'.repeat(60)}`)
console.log(`Berkie is wired to Slack channel ${SLACK_CHANNEL}`)
console.log(`Topic:        ${topicId}`)
console.log(`Conversation: ${conversationId}`)
console.log(`\nNext step: upload PDFs`)
console.log(`  node scripts/upload-pdfs.mjs`)
console.log(`${'─'.repeat(60)}\n`)
