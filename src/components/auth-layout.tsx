import type { ReactNode } from "react";
import type { Dictionary } from "@/i18n/dictionaries";

// Qur'anic content, not a UI string: shown verbatim in every language, always as Arabic.
const OPENING_VERSE = "اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ";

/**
 * Split layout for sign-in, join and invitation pages (ui-plan §4, F2): a welcome panel on
 * the inline-start side and the form card on the other. On phones only the card is shown.
 */
export function AuthLayout({
  panel,
  title,
  intro,
  children,
}: {
  panel: Dictionary["authPanel"];
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth-split">
      <aside className="auth-panel">
        <p className="auth-verse" lang="ar" dir="rtl">
          {OPENING_VERSE}
        </p>
        <p className="auth-verse-ref">{panel.verseRef}</p>
        <h2 className="auth-panel-title">{panel.title}</h2>
        <p className="muted">{panel.body}</p>
        <ul className="check-list">
          <li>{panel.point1}</li>
          <li>{panel.point2}</li>
          <li>{panel.point3}</li>
        </ul>
      </aside>
      <section className="auth-card">
        <h1>{title}</h1>
        {intro}
        {children}
      </section>
    </div>
  );
}
