import { Icon } from "@/components/icons";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";

// Public landing page (ui-plan §4, F7). Honest by construction: joining is by invitation (A45,
// A65 — public sign-ups stay disabled), so there is no "sign up" button, and no invented
// figures, ratings or testimonials. The subject names in Arabic are content, shown as Arabic
// in every language; their captions come from the dictionary.

const SUBJECTS = [
  { key: "quran", ar: "القُرْآن" },
  { key: "tajwid", ar: "التَّجْوِيد" },
  { key: "hifdh", ar: "الحِفْظ" },
  { key: "hadith", ar: "الحَدِيث" },
  { key: "aqidah", ar: "العَقِيدَة" },
  { key: "fiqh", ar: "الفِقْه" },
  { key: "tafsir", ar: "التَّفْسِير" },
  { key: "arabic", ar: "العَرَبِيَّة" },
] as const;

export function Landing({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const t = dict.landing;
  const steps = [
    { title: t.step1Title, body: t.step1Body },
    { title: t.step2Title, body: t.step2Body },
    { title: t.step3Title, body: t.step3Body },
  ];
  const roles = [
    { icon: "classes", title: t.roleStudentTitle, body: t.roleStudentBody },
    { icon: "board", title: t.roleTeacherTitle, body: t.roleTeacherBody },
    { icon: "markaz", title: t.roleMarkazTitle, body: t.roleMarkazBody },
    { icon: "account", title: t.roleParentTitle, body: t.roleParentBody },
  ] as const;

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-text">
          <p className="badge badge-accent">{dict.home.badge}</p>
          <h1 id="hero-title" className="hero-title">
            {t.titleLead} <span className="hero-accent">{t.titleAccent}</span>
          </h1>
          <p className="hero-subtitle">{t.subtitle}</p>
          <ul className="check-list">
            <li>{t.point1}</li>
            <li>{t.point2}</li>
            <li>{t.point3}</li>
          </ul>
          <div className="hero-actions">
            <a className="button button-primary button-lg" href={`/${locale}/sign-in`}>
              {t.start}
            </a>
            <details className="have-link">
              <summary className="button button-secondary button-lg">{t.haveLink}</summary>
              <p className="muted">{t.haveLinkNote}</p>
            </details>
          </div>
        </div>
        <div className="subject-grid" role="list" aria-label={t.subjectsLabel}>
          {SUBJECTS.map((s) => (
            <div key={s.key} role="listitem" className="subject-tile">
              <span className="subject-ar" lang="ar" dir="rtl">
                {s.ar}
              </span>
              <span className="subject-caption">{t.subjects[s.key]}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="section-title">
          {t.howHeading}
        </h2>
        <ol className="steps list-reset">
          {steps.map((s, i) => (
            <li key={i} className="card step">
              <span className="step-number" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="card-title">{s.title}</h3>
              <p className="muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="for-everyone">
        <h2 id="for-everyone" className="section-title">
          {t.rolesHeading}
        </h2>
        <ul className="card-grid list-reset">
          {roles.map((r) => (
            <li key={r.title} className="card role-card">
              <span className="role-icon">
                <Icon name={r.icon} size={26} />
              </span>
              <h3 className="card-title">{r.title}</h3>
              <p className="muted">{r.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="cta-band" aria-labelledby="cta-title">
        <h2 id="cta-title">{t.ctaTitle}</h2>
        <p className="muted">{t.ctaBody}</p>
        <a className="button button-primary button-lg" href={`/${locale}/sign-in`}>
          {t.start}
        </a>
      </section>
    </div>
  );
}
