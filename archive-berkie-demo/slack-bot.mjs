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
  console.warn('public/entries.json not found — wiki cards will be text-only')
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

// ── LLM-based entry classification + synthesis ────────────────────────────────

const ENTRY_CONTEXT = Object.entries(ENTRIES)
  .map(([slug, e]) => {
    const l2 = htmlToMrkdwn(e.l2 ?? '')
    const titles = (e.l3 ?? []).map(i => i.t).filter(Boolean).join(' · ')
    return `${slug}: ${e.l1?.label ?? slug} — ${e.l1?.gloss ?? ''}\n  ${l2}${titles ? `\n  Items: ${titles}` : ''}`
  })
  .join('\n\n')

async function classifyAndSynthesize(query, response) {
  const apiKey  = process.env.OPENAI_API_KEY
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  if (!apiKey || !Object.keys(ENTRIES).length) return { slug: null, synthesis: null }

  const prompt =
`You are matching a user's question to the single most relevant BKC Archive Wiki entry.

User question: "${query}"

Wiki entries (slug: label — gloss / excerpt / item titles):
${ENTRY_CONTEXT}

Rules:
- Think conceptually. "Privacy and AI" maps to surveillance, data collection, or regulatory frameworks — not necessarily an entry with the word "privacy" in its title.
- Pick the entry whose CONTENT most directly addresses the user's underlying concern, even if phrased differently.
- If no entry is a strong match, return {"slug": "none", "synthesis": null}.
- Do NOT default to a broad or high-profile entry just because it shares a generic term like "AI" or "democracy."

For the synthesis field:
- Frame the archive entry through the lens of the user's question. If the user asked about privacy, explain what this entry reveals about privacy — even if the entry title doesn't use that word.
- Be concrete: reference actual angles, cases, or framings from the entry. No filler phrases.
- 1–2 sentences only.

Respond with JSON only: {"slug": "...", "synthesis": "..."}`

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    })
    if (!res.ok) { console.warn('[classify] API error', res.status); return { slug: null, synthesis: null } }
    const parsed = JSON.parse((await res.json()).choices?.[0]?.message?.content ?? '{}')
    const slug = (parsed.slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
    const synthesis = (parsed.synthesis ?? '').trim()
    console.log(`[classify] → ${slug}`)
    return {
      slug: (slug && slug !== 'none' && ENTRIES[slug]) ? slug : null,
      synthesis: synthesis || null
    }
  } catch (e) {
    console.warn('[classify] failed:', e.message)
    return { slug: null, synthesis: null }
  }
}

// ── Card builder (mirrors NextSpace card design) ──────────────────────────────

function htmlToMrkdwn(html) {
  return (html ?? '')
    .replace(/<b>(.*?)<\/b>/g, '*$1*')
    .replace(/<i>(.*?)<\/i>/g, '_$1_')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function buildCard(entry, generatedSynthesis) {
  const l1 = entry.l1
  const kindLabel = l1.kind === 'topic'  ? 'Topic'
                  : l1.kind === 'person' ? 'Person'
                  : l1.kind === 'org'    ? 'Organization'
                  : 'Index'

  // Generated synthesis bridges the quip to the wiki entry; fall back to wiki prose
  const wikiSynth = htmlToMrkdwn(entry.l2)
  const synthesis = generatedSynthesis ?? (wikiSynth.length > 400 ? wikiSynth.slice(0, 397) + '…' : wikiSynth)

  // L3 curated items from entries.json — real titles, URLs, domains
  const items = (entry.l3 ?? []).slice(0, 4).map(it => {
    const title = it.url ? `<${it.url}|${it.t}>` : it.t
    const meta = it.clinic ? `_${it.dom} · Cyberlaw Clinic_` : `_${it.dom}_ · ${it.d}`
    return `• ${title} · ${meta}`
  }).join('\n')

  const wikiUrl = (() => {
    const sub = l1.kind === 'topic' ? 'topics' : l1.kind === 'person' ? 'people' : l1.kind === 'org' ? 'orgs' : null
    return sub
      ? `https://szgrune.github.io/bkc-archive-wiki/${sub}/${entry.slug}`
      : 'https://szgrune.github.io/bkc-archive-wiki/'
  })()

  return [
    // Kicker — mirrors sc-kicker + pill in NextSpace
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📚 From the BKC Archive Wiki* · _${kindLabel} · ${l1.label}_${l1.count ? ` — ${l1.count} items` : ''}`
      }
    },
    { type: 'divider' },
    // L2 synthesis (from RAG)
    {
      type: 'section',
      text: { type: 'mrkdwn', text: synthesis }
    },
    // L3 curated items
    ...(items ? [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*Cited items*\n${items}` }
    }] : []),
    // Open wiki button
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open wiki page →' },
        url: wikiUrl,
        action_id: 'open_wiki'
      }]
    },
    // Provenance footer
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `held in: ${entry.prov?.where ?? 'BKC Archive Wiki'} · maintained by: ${entry.prov?.who ?? 'LLM synthesis'}`
      }]
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

async function fetchChannelContext(client, channel, excludeTs) {
  try {
    const result = await client.conversations.history({
      channel,
      limit: 12,
      exclude_archived: true
    })
    const msgs = (result.messages ?? [])
      .filter(m => m.ts !== excludeTs && !m.subtype && m.text)
      .slice(0, 10)
      .reverse()
    if (!msgs.length) {
      console.log('[context] no prior messages found')
      return ''
    }
    // Truncate individual messages so a long paste doesn't dominate
    const lines = msgs.map(m => {
      const text = m.text.replace(/<[^>]+>/g, '').trim()
      const truncated = text.length > 300 ? text.slice(0, 297) + '…' : text
      return `[${m.username ?? m.user ?? 'user'}]: ${truncated}`
    })
    console.log(`[context] ${msgs.length} messages fetched from ${channel}`)
    return `Recent channel conversation (for context only):\n${lines.join('\n')}\n\n`
  } catch (e) {
    console.warn('[context] failed to fetch channel history:', e.message)
    return ''
  }
}

slackApp.event('app_mention', async ({ event, client }) => {
  // Keep bot name in the query so the historian's intent check recognises it
  const query = event.text.replace(/<@[A-Z0-9]+>/g, `@${process.env.SLACK_BOT_NAME ?? 'archive-berkie'}`).trim()
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
    const context = await fetchChannelContext(client, event.channel, event.ts)
    const sentAt = new Date()
    await sendMessage(context + query)
    const raw = await pollResponse(sentAt)
    const response = raw
      ? raw
          .replace(/^[^.\n!?]{0,60}:\s+(?=[A-Z“””])/, '') // strip “Label: “ prefix added by LLM Engine
          .replace(/^[“””']+|[“””']+$/g, '')                          // strip surrounding quotes
          .trim()
      : null
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

    // Card: LLM picks entry + generates bridge synthesis
    const { slug, synthesis: generatedSynthesis } = await classifyAndSynthesize(query, response)
    const entry = slug ? ENTRIES[slug] : null
    if (entry) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: `From the BKC Archive Wiki — ${entry.l1.label}`,
        blocks: buildCard(entry, generatedSynthesis),
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
