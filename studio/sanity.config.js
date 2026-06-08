import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";

import { schemaTypes } from "./schemaTypes";

// Project/dataset come from env so this config can be committed safely.
// Set these in studio/.env (see studio/.env.example). The projectId should
// match NEXT_PUBLIC_SANITY_PROJECT_ID used by the Next.js app.
const projectId = process.env.SANITY_STUDIO_PROJECT_ID || "";
const dataset = process.env.SANITY_STUDIO_DATASET || "production";

export default defineConfig({
  name: "default",
  title: "BKC Archive",

  projectId,
  dataset,

  plugins: [
    structureTool(),
    // Vision lets you test GROQ queries against your dataset from within the Studio.
    visionTool(),
  ],

  schema: {
    types: schemaTypes,
  },
});
