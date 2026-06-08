// Register every document/object type here. This array is the single source
// of truth for the Studio's schema.
//
// Right now it contains one minimal placeholder type (`entry`) so the Studio
// is usable out of the box. Replace it with the real BKC Archive types when
// you're ready — add a file per type in this folder and import it below.

import entry from "./entry";

export const schemaTypes = [entry];
