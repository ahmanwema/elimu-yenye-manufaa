/**
 * Markaz switcher (ui-plan §4, F5) for a person who belongs to several Markaz. Plain links in a
 * <details> disclosure — no JavaScript, no state: the Markaz in the URL is the current one, and
 * the destination page performs its own authorization as always. Renders nothing for one Markaz.
 */
export function MarkazSwitcher({
  tenants,
  currentId,
  locale,
  path = "",
  label,
  currentLabel,
}: {
  tenants: readonly { id: string; name: string }[];
  currentId: string;
  locale: string;
  /** Sub-page to keep when switching, e.g. "/finance". */
  path?: string;
  label: string;
  currentLabel: string;
}) {
  if (tenants.length < 2) return null;
  const current = tenants.find((t) => t.id === currentId);
  return (
    <details className="switcher">
      <summary>
        <span className="muted">{label}:</span> <strong>{current?.name ?? currentLabel}</strong>
      </summary>
      <ul className="switcher-menu">
        {tenants.map((t) => (
          <li key={t.id}>
            <a href={`/${locale}/markaz/${encodeURIComponent(t.id)}${path}`} aria-current={t.id === currentId ? "page" : undefined}>
              {t.name}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
