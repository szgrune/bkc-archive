import { defineField, defineType } from "sanity";

// PLACEHOLDER TYPE — safe to rename, restructure, or delete.
// It exists so the blank-slate Studio has something to edit and so Claude Code
// has a working pattern to copy when adding real BKC Archive schema types.
//
// Pattern to follow for new types:
//   1. Create a file in this folder, e.g. `collection.js`.
//   2. `export default defineType({ name, title, type: "document", fields })`.
//   3. Import and add it to the array in `./index.js`.
export default defineType({
  name: "entry",
  title: "Entry",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "title", maxLength: 96 },
    }),
    defineField({
      name: "date",
      title: "Date",
      type: "datetime",
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      of: [{ type: "block" }, { type: "image" }],
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "date" },
  },
});
