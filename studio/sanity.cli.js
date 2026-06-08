import { defineCliConfig } from "sanity/cli";

// Used by the `sanity` CLI (dev, build, deploy, dataset import/export).
const projectId = process.env.SANITY_STUDIO_PROJECT_ID || "";
const dataset = process.env.SANITY_STUDIO_DATASET || "production";

export default defineCliConfig({
  api: {
    projectId,
    dataset,
  },
  // Studio is bundled with Vite by default; no extra config needed.
});
