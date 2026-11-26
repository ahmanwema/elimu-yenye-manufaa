/**
 * Terms and Privacy pages (A157). The text lives in the dictionaries so it reads in all three
 * languages; it is a DRAFT until reviewed by a lawyer, and the page says so at the top.
 */
export function LegalPage({
  title,
  draftNotice,
  updated,
  sections,
}: {
  title: string;
  draftNotice: string;
  updated: string;
  sections: readonly { title: string; body: string }[];
}) {
  return (
    <article className="legal">
      <h1>{title}</h1>
      <p className="muted">{updated}</p>
      <p role="note" className="callout callout-warning">
        {draftNotice}
      </p>
      {sections.map((s) => (
        <section key={s.title} className="legal-section">
          <h2>{s.title}</h2>
          <p>{s.body}</p>
        </section>
      ))}
    </article>
  );
}
