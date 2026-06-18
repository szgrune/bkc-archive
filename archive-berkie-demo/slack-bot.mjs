/**
 * slack-bot.mjs — @archive-berkie Slack bot (Socket Mode)
 *
 * Listens for @archive-berkie mentions anywhere the bot is invited.
 * Replies in-thread with the LLM Engine response + a Block Kit wiki card
 * showing L1 header, L2 synthesis snippet, L3 linked items, and a wiki link.
 *
 * Setup:
 *   1. Create a Slack app named "archive-berkie" (see README or instructions below)
 *   2. Add SLACK_BOT_TOKEN and SLACK_APP_TOKEN to .env
 *   3. node slack-bot.mjs
 *
 * Usage in Slack:
 *   @archive-berkie what has BKC covered on AI governance?
 */

import { App } from '@slack/bolt'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Load .env ─────────────────────────────────────────────────────────────────

function loadEnv() {
  const p = join(__dir, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

const LLM_URL = (process.env.LLM_ENGINE_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/v1'
const CONV_ID  = process.env.CONVERSATION_ID
const USERNAME = process.env.LLM_ENGINE_USERNAME
const PASSWORD = process.env.LLM_ENGINE_PASSWORD

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
  console.error('Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN in .env')
  process.exit(1)
}
if (!CONV_ID) {
  console.error('Missing CONVERSATION_ID in .env')
  process.exit(1)
}

// ── Load wiki entries ─────────────────────────────────────────────────────────

let ENTRIES = {}
const entriesPath = join(__dir, 'public', 'entries.json')
if (existsSync(entriesPath)) {
  ENTRIES = JSON.parse(readFileSync(entriesPath, 'utf8'))
  console.log(`Loaded ${Object.keys(ENTRIES).length} wiki entries`)
} else {
  console.warn('public/entries.json not found — run: node scripts/build-entries.mjs')
}

// ── LLM Engine helpers ────────────────────────────────────────────────────────

let jwt = null

async function login() {
  const res = await fetch(LLM_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  })
  const d = await res.json()
  jwt = d?.tokens?.access?.token
  if (!jwt) throw new Error('Auth failed: ' + JSON.stringify(d).slice(0, 120))
  console.log('Authenticated with LLM Engine')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function sendMessage(text) {
  const res = await fetch(LLM_URL + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ body: text, conversation: CONV_ID })
  })
  if (!res.ok) throw new Error(`Send failed ${res.status}: ${(await res.text()).slice(0, 120)}`)
}

async function pollResponse(sentAt) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    await sleep(1800)
    try {
      const res = await fetch(
        `${LLM_URL}/messages/${CONV_ID}?sortBy=createdAt:desc&limit=10`,
        { headers: { Authorization: `Bearer ${jwt}` } }
      )
      if (!res.ok) continue
      const data = await res.json()
      const msgs = Array.isArray(data) ? data : (data.results ?? data.data ?? [])
      for (const m of msgs) {
        if (!m.fromAgent) continue
        if (new Date(m.createdAt) <= sentAt) continue
        const raw = m.body
        if (typeof raw === 'string') return raw
        if (raw && typeof raw === 'object') return raw.text ?? raw.content ?? JSON.stringify(raw)
      }
    } catch { /* keep polling */ }
  }
  return null
}

// ── Entry matching ────────────────────────────────────────────────────────────

function matchEntry(text) {
  const q = text.toLowerCase()
  let best = null, bestScore = 0
  for (const [slug, entry] of Object.entries(ENTRIES)) {
    const score = (entry.keywords ?? [])
      .filter(kw => kw.length >= 3 && q.includes(kw)).length
    if (score > bestScore) { bestScore = score; best = slug }
  }
  return bestScore >= 2 ? best : null
}

// ── Block Kit builder ─────────────────────────────────────────────────────────

function htmlToMrkdwn(html) {
  return (html ?? '')
    .replace(/<b>(.*?)<\/b>/g, '*$1*')
    .replace(/<i>(.*?)<\/i>/g, '_$1_')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function wikiPageUrl(entry) {
  const sub = entry.l1.kind === 'topic'  ? 'topics'
            : entry.l1.kind === 'person' ? 'people'
            : entry.l1.kind === 'org'    ? 'orgs'
            : null
  return sub
    ? `https://szgrune.github.io/bkc-archive-wiki/${sub}/${entry.slug}`
    : 'https://szgrune.github.io/bkc-archive-wiki/'
}

function buildBlocks(entry) {
  const l1 = entry.l1
  const kindLabel = l1.kind === 'topic'  ? 'Topic'
                  : l1.kind === 'person' ? 'Person'
                  : l1.kind === 'org'    ? 'Organization'
                  : 'Index'

  // L2 — truncate synthesis to 280 chars for Slack
  const prose = htmlToMrkdwn(entry.l2)
  const snippet = prose.length > 280 ? prose.slice(0, 277) + '…' : prose

  // L3 — up to 4 items, linked where possible
  const items = (entry.l3 ?? []).slice(0, 4).map(it => {
    const title = it.url ? `<${it.url}|${it.t}>` : it.t
    return `• ${title} · _${it.dom}_ · ${it.d}`
  }).join('\n')

  const conf = Math.round((entry.conf ?? 0.8) * 100)
  const provText = `${entry.prov?.where ?? 'BKC Archive Wiki'} · maintained by LLM · confidence ${conf}%`

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📚 From the BKC Archive Wiki*\n_${kindLabel} · ${l1.label}_ — ${l1.count} items`
      }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*L2 — Synthesis*\n${snippet}` }
    },
    ...(items ? [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*L3 — Key items*\n${items}` }
    }] : []),
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Full wiki page →' },
        url: wikiPageUrl(entry),
        action_id: 'open_wiki'
      }]
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: provText }]
    }
  ]
}

// ── Slack app ─────────────────────────────────────────────────────────────────

const slackApp = new App({
  token:     process.env.SLACK_BOT_TOKEN,
  appToken:  process.env.SLACK_APP_TOKEN,
  socketMode: true,
})

// Acknowledge button clicks (required by Slack, even for url-type buttons)
slackApp.action('open_wiki', async ({ ack }) => { await ack() })

slackApp.event('app_mention', async ({ event, client }) => {
  const query = event.text.replace(/<@[A-Z0-9]+>/g, '').trim()
  if (!query) return

  console.log(`[Slack] @mention in ${event.channel}: "${query.slice(0, 80)}"`)

  // Thinking indicator in thread
  let thinkingTs = null
  try {
    const t = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: '⏳ Checking the BKC Archive Wiki…'
    })
    thinkingTs = t.ts
  } catch { /* non-fatal */ }

  const deleteThinking = async () => {
    if (thinkingTs) {
      await client.chat.delete({ channel: event.channel, ts: thinkingTs }).catch(() => {})
      thinkingTs = null
    }
  }

  try {
    if (!jwt) await login()
    const sentAt = new Date()
    await sendMessage(query)
    const response = await pollResponse(sentAt)
    await deleteThinking()

    if (!response) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "I didn't get a response in time — try again in a moment."
      })
      return
    }

    // Text response
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: response
    })

    // Wiki surfacing card
    const slug  = matchEntry(query + ' ' + response)
    const entry = slug ? ENTRIES[slug] : null
    if (entry) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `From the BKC Archive Wiki — ${entry.l1.label}`,
        blocks: buildBlocks(entry),
        unfurl_links: false
      })
    }
  } catch (e) {
    console.error('[Slack] Error:', e.message)
    await deleteThinking()
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `Something went wrong: ${e.message}`
    }).catch(() => {})
  }
})

await login()
await slackApp.start()
console.log('⚡ @archive-berkie is live in Slack (Socket Mode) — mention it in any channel it\'s in')
