import { createClient } from "next-sanity";

import { apiVersion, dataset, isSanityConfigured, projectId } from "./env";

// Read-only client used by the Next.js app to fetch published content.
// Falls back to a placeholder projectId when Sanity isn't configured yet so
// imports don't crash; pages should gate real fetches on `isSanityConfigured`.
export const client = createClient({
  projectId: projectId || "placeholder",
  dataset: dataset || "production",
  apiVersion,
  useCdn: true,
});

// Run a GROQ query from Server Components. Returns `fallback` (default null)
// when Sanity isn't configured yet, so the blank-slate app still renders.
export async function sanityFetch(query, params = {}, fallback = null) {
  if (!isSanityConfigured) return fallback;
  return client.fetch(query, params);
}
