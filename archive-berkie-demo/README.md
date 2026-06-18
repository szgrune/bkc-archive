# BKC Berkie Demo

Bootstraps a Berkie chatbot against the BKC archive wiki, wired to Slack via LLM Engine + AWS Bedrock.

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 (for native fetch) |
| MongoDB | running locally |
| ChromaDB | running locally |
| LLM Engine | cloned and configured |
| AWS Bedrock | access key + secret |
| Slack app | bot token + channel ID |

## One-time setup

### 1. Install ChromaDB and start it

```bash
pip install chromadb
chroma run --host 0.0.0.0 --port 8000
```

### 2. Clone and start LLM Engine

```bash
git clone https://github.com/berkmancenter/llm_engine
cd llm_engine
cp .env.example .env
```

Edit `llm_engine/.env` — minimum required:

```ini
BEDROCK_API_KEY=<aws-access-key-id>:<aws-secret-access-key>
BEDROCK_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com
CORE_LLM_PLATFORM=bedrock
CORE_LLM_MODEL=anthropic.claude-haiku-4-5-20251001-v1:0
CHROMA_DB_URL=http://0.0.0.0:8000
CONVERSATION_BOT_NAME=Berkie
JWT_SECRET=<any-random-string>
SLACK_SIGNING_SECRET=<from-slack-app-settings>
SYSTEM_USERS=admin:admin,berkie-bot:serviceAccount
```

Then:

```bash
yarn install
yarn run dev
```

### 3. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From Scratch
2. Under **OAuth & Permissions**, add bot scopes: `chat:write`, `app_mentions:read`, `channels:history`, `im:history`
3. Install to your workspace → copy the **Bot User OAuth Token** (`xoxb-...`)
4. Under **Event Subscriptions**, enable and set request URL to `https://<ngrok-url>/v1/slack/events`
5. Subscribe to bot events: `message.channels`, `app_mention`
6. Under **Basic Information** → copy **Signing Secret**

### 4. Clone the BKC archive wiki (for raw data)

```bash
git clone https://github.com/szgrune/bkc-archive-wiki
```

### 5. Configure this project

```bash
cd bkc-berkie-demo
cp .env.example .env
# Edit .env — fill in all values
yarn install
```

### 6. Start ngrok (to make LLM Engine reachable from Slack)

```bash
ngrok http 3000
# Copy the https://... forwarding URL into your Slack app's Event Subscriptions
```

## Run the demo setup

```bash
# Step 1: parse archive.json into year chunks
node scripts/prepare-archive.mjs

# Step 2: generate PDFs from chunks
node scripts/generate-pdfs.mjs

# Step 3: create topic + conversation + Slack wiring in LLM Engine
node setup.mjs

# Step 4: upload PDFs as RAG resources (wait ~1 min after for ChromaDB indexing)
node scripts/upload-pdfs.mjs
```

Or all at once:

```bash
npm run all
```

## Testing Berkie in Slack

1. Invite `@Berkie` to your `#berkie-demo` channel
2. Ask it something: `@Berkie what has BKC published on AI governance since 2020?`
3. Berkie retrieves from the uploaded PDF archive and responds with citations

## Troubleshooting

**400 on POST /conversations** — open `http://localhost:3000/v1/docs` and compare the field names against `setup.mjs`. The `agentTypes[].properties` field names (`llmPlatform`, `llmModel`, `systemPrompt`) may differ.

**PDF upload 404** — the resource stub IDs in `.setup-state.json` may be stale. Re-run `setup.mjs` (it creates a fresh conversation each time) then re-run `upload-pdfs.mjs`.

**Berkie doesn't respond in Slack** — check that the ngrok URL is set correctly in the Slack app's Event Subscriptions, and that `SLACK_SIGNING_SECRET` matches in `llm_engine/.env`.

**ChromaDB not indexing** — check that ChromaDB is running at `http://0.0.0.0:8000` and that `CHROMA_DB_URL` in `llm_engine/.env` matches.
