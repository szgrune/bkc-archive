@AGENTS.md

# BKC Archive — guide for Claude Code

A blank-slate **archive** web app. Next.js (App Router, JavaScript) frontend +
an embedded **Sanity** Studio as the CMS. This repo is set up so content and
schema can be populated programmatically.

## Layout

```
.
├── app/                  Next.js App Router (pages, layout, styles)
├── sanity/               Frontend Sanity client + helpers
│   ├── env.js            Reads NEXT_PUBLIC_SANITY_* env vars (no throw if unset)
│   ├── client.js         Read-only client + sanityFetch(query, params, fallback)
│   └── image.js          urlFor(image) helper for Sanity images
├── scripts/
│   └── seed.mjs          Bulk content seeding via @sanity/client write token
├── studio/               Embedded Sanity Studio (its own package + node_modules)
│   ├── sanity.config.js  Studio config (projectId/dataset from SANITY_STUDIO_* env)
│   ├── sanity.cli.js     CLI config (dev/build/deploy/import)
│   └── schemaTypes/      Schema definitions — one file per type
│       ├── index.js      Registers all types (single source of truth)
│       └── entry.js      PLACEHOLDER type — replace with real archive types
├── .env.local            Frontend + seed secrets (gitignored)
└── studio/.env           Studio projectId/dataset (gitignored)
```

## Commands (run from repo root)

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | Next.js dev server → http://localhost:3000        |
| `npm run studio`        | Sanity Studio dev server → http://localhost:3333  |
| `npm run seed`          | Seed/replace content from `scripts/seed.mjs`      |
| `npm run build`         | Production build of the Next.js app               |
| `npm run studio:deploy` | Deploy the Studio to `<project>.sanity.studio`    |

## How to ADD A SCHEMA TYPE

1. Create `studio/schemaTypes/<typeName>.js` using `defineType` /
   `defineField` (copy the structure of `entry.js`).
2. Import it and add it to the array in `studio/schemaTypes/index.js`.
3. The change is picked up live by a running `npm run studio`.

Document types use `type: "document"`. Reusable object shapes (e.g. an
address) can be their own object type and referenced via `type: "<name>"`.
Use `type: "reference"` with `to: [{ type: "..." }]` to link documents.

## How to POPULATE CONTENT

Two supported paths — prefer code for anything more than a few docs:

1. **Seed script (bulk, idempotent):** edit the `documents` array in
   `scripts/seed.mjs`, then `npm run seed`. Give each doc a stable `_id` and a
   `_type` matching a registered schema type. `createOrReplace` means re-runs
   update instead of duplicating.

2. **NDJSON import (large datasets):** create a `.ndjson` file (one JSON doc
   per line) and run
   `cd studio && npx sanity dataset import ../data/seed.ndjson production`.

3. **By hand:** `npm run studio` and create documents in the UI.

Portable Text (rich text `body` fields) is an array of `block` objects; each
block needs a unique `_key`, as does every child span. See `seed.mjs` for the
exact shape.

## How to QUERY CONTENT in the app

Use GROQ via `sanityFetch` from a Server Component:

```js
import { sanityFetch } from "@/sanity/client";

const entries = await sanityFetch(
  `*[_type == "entry"] | order(date desc){ _id, title, slug }`
);
```

`sanityFetch` returns the `fallback` arg (default `null`) when Sanity isn't
configured yet, so pages stay renderable on a blank slate.

## Environment / first-time setup

The app boots without Sanity and shows setup instructions. To connect a real
project, fill in `.env.local` and `studio/.env` (see the `*.example` files and
README). `NEXT_PUBLIC_SANITY_PROJECT_ID`, `SANITY_STUDIO_PROJECT_ID`, and the
seed token must all reference the **same** Sanity project. Never commit real
tokens.

## Conventions

- JavaScript (no TypeScript). ES modules everywhere.
- Path alias `@/*` maps to the repo root (e.g. `@/sanity/client`).
- The `studio/` package is installed independently — run `npm install` inside
  it after changing its dependencies.
- This is **Next.js 16** — see `AGENTS.md` above; check
  `node_modules/next/dist/docs/` before using framework APIs from memory.
