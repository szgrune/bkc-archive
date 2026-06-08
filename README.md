# BKC Archive

An **archive** web app: a [Next.js](https://nextjs.org) (App Router, JavaScript)
frontend with an embedded [Sanity](https://sanity.io) Studio as the CMS. We build
it with a mix of **[Claude Code](https://claude.com/claude-code)** and hands-on
editing — this README explains how to run it locally and how those two workflows
fit together.

## Stack

- **Next.js 16** + React 19 (App Router, JavaScript) — the public site
- **Sanity v4** Studio embedded in [`studio/`](./studio) — the CMS
- `next-sanity` for reading content into the app
- Shared Sanity project `lwvigy05`, dataset `production`

## The mental model: code vs. content

This is the most important thing to understand before contributing. The project
has **two layers that live in different places**:

| Layer | What it is | Where it lives | How it's versioned |
| ----- | ---------- | -------------- | ------------------ |
| **Code** | App design (pages, components, styles) + the **schema** (what fields/types exist) | This Git repo | Branches & PRs on GitHub |
| **Content** | The actual documents/data in the archive | Sanity's hosted `production` dataset | Live & shared — *not* in Git |

Consequences worth internalizing:

- **Schema changes are code.** Adding/renaming a field happens in
  `studio/schemaTypes/*` and goes through a branch + PR like any code change.
- **Content is shared and live.** When you create or edit a document in the
  Studio (or via the seed script / MCP), everyone sees it immediately — there's
  no "my branch's content." Treat the dataset like a shared database.
- Because content isn't in Git, you can safely experiment with **design/schema
  on a branch** without touching anyone's data. Just avoid *destructive* schema
  renames against fields that already hold real content (see
  [Evolving the schema](#evolving-the-schema)).

## Prerequisites

- **Node 20+** and npm
- **Access to the Sanity project.** Ask a maintainer to invite your email at
  [sanity.io/manage](https://sanity.io/manage) → BKC Archive → Members. You need
  this to open the Studio and to mint API tokens.
- *(Recommended)* the **Claude Code** CLI — see [Building with Claude Code](#building-with-claude-code-and-by-hand).

## Getting started

```bash
# 1. Clone
git clone https://github.com/szgrune/bkc-archive.git
cd bkc-archive

# 2. Install dependencies (two packages: the app, and the Studio)
npm install
npm install --prefix studio

# 3. Create your local env files (project IDs are pre-filled; they're public)
cp .env.local.example .env.local
cp studio/.env.example studio/.env

# 4. Log in to Sanity once (opens a browser)
npx sanity login

# 5. Run the app and the Studio in two terminals
npm run dev      # site   → http://localhost:3000
npm run studio   # Studio → http://localhost:3333
```

That's it — both connect to the shared `production` dataset, so you'll see real
content right away.

**Optional — content seeding from code.** Only needed if you'll run
`npm run seed`. Create an **Editor** token at sanity.io/manage → API → Tokens,
and paste it into `.env.local` as `SANITY_API_WRITE_TOKEN`. Keep it secret;
`.env.local` is gitignored.

## Project structure

```
app/                  Next.js pages, layout, styles  ← app design
sanity/               Frontend Sanity client + image/query helpers
scripts/seed.mjs      Bulk content seeding from code
studio/schemaTypes/   Schema definitions, one file per type  ← the data model
CLAUDE.md             Deep guide for Claude Code (and humans)
```

[`CLAUDE.md`](./CLAUDE.md) has the detailed conventions and code patterns; this
README is the "how we work" overview.

## Building with Claude Code and by hand

We use both, often in the same sitting. They edit the **code layer** (design +
schema); content can be handled by either a human in the Studio or by Claude via
the Sanity tools.

### Claude Code

Run `claude` in the repo root. It automatically reads `CLAUDE.md`, so it knows
the layout, the commands, and the schema/content patterns. Good prompts:

- *"Add a `collection` document type with title, description, and a list of
  references to `entry` documents, then register it."*
- *"Build a `/collections` page that lists all collections with their entry
  counts."*
- *"Restyle the homepage as a responsive grid of archive entries."*

**Sanity MCP (recommended).** Connect the [Sanity MCP server](https://github.com/sanity-io/sanity-mcp-server)
so Claude can read the live schema and query/create/patch **content** directly,
instead of only writing seed code:

```bash
claude mcp add sanity -- npx -y @sanity/mcp-server@latest
```

(Provide the project's API credentials when prompted; see the server's README.)
With it connected you can ask things like *"import these 30 records as `entry`
documents"* or *"find all entries missing a date and list them."*

### Editing by hand

Everything Claude does, you can do directly — they share the same files and the
same dataset, so work in tandem freely:

- **Design / code:** edit `app/**` and `sanity/**` in your editor. The dev
  server hot-reloads.
- **Schema:** edit `studio/schemaTypes/**`. A running Studio picks it up live.
- **Content:** use the Studio UI at `localhost:3333` to create and edit
  documents.

A common rhythm: let Claude scaffold a schema type or page, then refine the copy,
styling, and real content yourself in the Studio.

> **Heads-up when working in tandem:** if Claude edits files while you have them
> open, pull its changes into your editor before saving to avoid clobbering them.
> For schema work, keep one source of truth — let Claude finish a type, then
> tweak — rather than both editing the same file simultaneously.

## Evolving the schema

1. Add or edit a type in `studio/schemaTypes/<type>.js` (copy `entry.js`'s
   shape), then register it in `studio/schemaTypes/index.js`.
2. A running `npm run studio` reflects the change immediately.
3. Commit the change on a branch and open a PR.

Because content lives in the shared dataset, **renaming or removing a field that
already holds data won't delete the data** — old documents keep the old field
until migrated. For anything beyond adding fields, coordinate in the PR and use a
[content migration](https://www.sanity.io/docs/content-migrations) if needed.

## Uploading content

Pick whatever fits the job:

| Method | Best for |
| ------ | -------- |
| **Studio UI** (`npm run studio`) | Writing/editing individual documents by hand |
| **Claude + Sanity MCP** | Importing or transforming batches conversationally |
| **Seed script** (`npm run seed`) | Reproducible bulk inserts; edit `scripts/seed.mjs` |
| **NDJSON import** | Large one-off datasets: `cd studio && npx sanity dataset import ../data/seed.ndjson production` |

All write to the same shared dataset and need write access (a token, or being
logged in).

## Deploy

- **Site:** deploy `app/` to Vercel (or any Node host) and set
  `NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` in its dashboard.
- **Studio:** `npm run studio:deploy` → hosts at `<project>.sanity.studio`.

## Contributing checklist

- Branch off `main`; open a PR for code/schema changes.
- Run `npm run build` before pushing to catch errors.
- Never commit `.env.local`, `studio/.env`, or tokens (already gitignored).
- Remember: your PR changes **code**, but the **content** it renders is live and
  shared — coordinate destructive schema changes.
