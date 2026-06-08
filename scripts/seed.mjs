// Programmatic content seeding for the BKC Archive.
//
// This is the recommended path for Claude Code (or you) to populate the CMS
// in bulk: build an array of documents and write them with the Sanity client.
// Run with:  npm run seed
//
// Requirements (in .env.local):
//   NEXT_PUBLIC_SANITY_PROJECT_ID
//   NEXT_PUBLIC_SANITY_DATASET
//   SANITY_API_WRITE_TOKEN   (Editor token from sanity.io/manage -> API -> Tokens)
//
// `createOrReplace` is idempotent: re-running updates existing docs by _id
// rather than creating duplicates. Give each seed doc a stable _id.

import { config as loadEnv } from "dotenv";
import { createClient } from "@sanity/client";

loadEnv({ path: ".env.local" });

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";
const token = process.env.SANITY_API_WRITE_TOKEN;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01";

if (!projectId || !token) {
  console.error(
    "\n  Missing config. Set NEXT_PUBLIC_SANITY_PROJECT_ID and " +
      "SANITY_API_WRITE_TOKEN in .env.local before seeding.\n"
  );
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion,
  token,
  useCdn: false,
});

// --- Edit this list to seed your own content -------------------------------
// Each document needs a `_type` matching a schema type in studio/schemaTypes.
const documents = [
  {
    _id: "entry.welcome",
    _type: "entry",
    title: "Welcome to the BKC Archive",
    slug: { _type: "slug", current: "welcome" },
    date: new Date().toISOString(),
    body: [
      {
        _type: "block",
        _key: "intro",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "intro-span",
            text: "This is a seeded example entry. Edit scripts/seed.mjs or use the Studio to add real content.",
          },
        ],
      },
    ],
  },
];
// ---------------------------------------------------------------------------

async function run() {
  console.log(`Seeding ${documents.length} document(s) into ${projectId}/${dataset}…`);
  const tx = documents.reduce(
    (transaction, doc) => transaction.createOrReplace(doc),
    client.transaction()
  );
  const result = await tx.commit();
  console.log(`Done. ${result.results.length} document(s) written.`);
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
