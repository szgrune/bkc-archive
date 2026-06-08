// Centralized Sanity environment configuration for the Next.js app.
// Values are read from environment variables so the same code works across
// local dev, preview, and production. See .env.local.example.
//
// These do NOT throw when unset so the app still boots as a blank slate
// before you've connected a Sanity project. Pages check `isSanityConfigured`
// and show setup instructions until the env vars are filled in.

export const apiVersion =
  process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01";

export const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "";

export const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "";

export const isSanityConfigured = Boolean(projectId && dataset);
