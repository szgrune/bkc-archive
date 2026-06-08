import imageUrlBuilder from "@sanity/image-url";

import { dataset, projectId } from "./env";

const builder = imageUrlBuilder({ projectId, dataset });

// Turn a Sanity image reference into a URL builder.
// Usage: urlFor(image).width(800).url()
export function urlFor(source) {
  return builder.image(source);
}
