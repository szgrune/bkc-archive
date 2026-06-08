# BKC Archive

A blank-slate **archive** web app: a [Next.js](https://nextjs.org) (App Router,
JavaScript) frontend with an embedded [Sanity](https://sanity.io) Studio as the
CMS. It boots and runs immediately; connect a Sanity project when you're ready,
then add schema types and content.

## Stack

- **Next.js 16** + React 19 (App Router, JavaScript)
- **Sanity v4** Studio embedded in [`studio/`](./studio)
- `next-sanity` for fetching content into the app

## Quick start

```bash
npm install              # frontend deps (already installed if you cloned fresh)
npm install --prefix studio   # Studio deps
npm run dev              # http://localhost:3000
```

The homepage shows setup instructions until you connect Sanity.

## Connect a Sanity project

1. **Log in / create a project.** From the repo root:
   ```bash
   cd studio
   npx sanity login
   npx sanity init          # create a new project + "production" dataset
   cd ..
   ```
   Note the **project ID** it reports (also visible at
   [sanity.io/manage](https://sanity.io/manage)).

2. **Fill in env files** (copy the examples first):
   ```bash
   cp .env.local.example .env.local
   cp studio/.env.example studio/.env
   ```
   Set the same project ID in both:
   - `.env.local` → `NEXT_PUBLIC_SANITY_PROJECT_ID`
   - `studio/.env` → `SANITY_STUDIO_PROJECT_ID`

3. **Run both servers:**
   ```bash
   npm run dev      # app    → http://localhost:3000
   npm run studio   # Studio → http://localhost:3333
   ```

## Add content

- **In the Studio UI:** `npm run studio`, then create documents.
- **In bulk via code:** add an Editor token at sanity.io/manage → API → Tokens,
  put it in `.env.local` as `SANITY_API_WRITE_TOKEN`, edit `scripts/seed.mjs`,
  then `npm run seed`.

## Add schema types

Schemas live in [`studio/schemaTypes/`](./studio/schemaTypes) — one file per
type, all registered in `index.js`. The included `entry` type is a placeholder
to replace. See [`CLAUDE.md`](./CLAUDE.md) for details and patterns.

## Deploy

- **App:** deploy to Vercel (or any Node host); set the `NEXT_PUBLIC_SANITY_*`
  env vars in the host's dashboard.
- **Studio:** `npm run studio:deploy` → hosts at `<project>.sanity.studio`.
