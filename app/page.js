import styles from "./page.module.css";
import { sanityFetch } from "@/sanity/client";
import { isSanityConfigured } from "@/sanity/env";

// Pull every published document that isn't a Sanity system doc. This is a
// deliberately generic query for the blank-slate archive — once you add real
// schema types, swap this for type-specific GROQ queries.
const ALL_DOCS_QUERY = `*[
  !(_type match "sanity.*") && !(_id in path("drafts.**"))
] | order(_createdAt desc){
  _id,
  _type,
  _createdAt,
  "title": coalesce(title, name, _id)
}`;

export default async function Home() {
  const docs = await sanityFetch(ALL_DOCS_QUERY, {}, []);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>BKC Archive</h1>
          <p className={styles.tagline}>
            A blank-slate archive built with Next.js and Sanity.
          </p>
        </header>

        {!isSanityConfigured ? (
          <section className={styles.notice}>
            <h2>Connect your Sanity project to get started</h2>
            <ol>
              <li>
                Copy <code>.env.local.example</code> to <code>.env.local</code>.
              </li>
              <li>
                Create a Sanity project (run <code>npx sanity login</code> then{" "}
                <code>npm run studio</code> from the repo root, or visit{" "}
                <a href="https://sanity.io/manage">sanity.io/manage</a>).
              </li>
              <li>
                Fill in <code>NEXT_PUBLIC_SANITY_PROJECT_ID</code> and{" "}
                <code>NEXT_PUBLIC_SANITY_DATASET</code>, then restart the dev
                server.
              </li>
            </ol>
            <p>
              See <code>CLAUDE.md</code> for how to define schemas and populate
              content.
            </p>
          </section>
        ) : docs.length === 0 ? (
          <section className={styles.notice}>
            <h2>No content yet</h2>
            <p>
              Sanity is connected but the dataset is empty. Add schema types in{" "}
              <code>studio/schemaTypes</code> and create documents in the Studio
              (<code>npm run studio</code>), or seed content with{" "}
              <code>npm run seed</code>.
            </p>
          </section>
        ) : (
          <section className={styles.list}>
            <h2>{docs.length} document(s) in the archive</h2>
            <ul>
              {docs.map((doc) => (
                <li key={doc._id}>
                  <span className={styles.docType}>{doc._type}</span>
                  <span className={styles.docTitle}>{doc.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
