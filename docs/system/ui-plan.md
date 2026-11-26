# UI plan — dark learning-platform layout

**Status (2026-11-26):** direction, palette and phases **APPROVED by the owner** (A152).
**All phases F0–F7 authorized and implemented** (A153). Further UI work (Live view, light theme, a
Hifdh streak) needs its own decision. Companion to [design-system.md](design-system.md), which holds the
token values.

## 0. Direction

The owner asked for the UI to follow the layout system and colour family of a modern dark
coding-education platform (reference screenshots kept **on the owner's machine only**, not in this
public repository). We adopt its *structure* — narrow icon rail, top bar with search and language,
card grids with small pill badges, tabs with counts, sortable tables, orange primary actions, a
bottom navigation bar on phones — with **our own token values, wordmark and text**. No logo,
illustration, copy or exact colour value of that platform is used (design-system.md §1, §6).

Not carried over unless decided separately: leagues and medals, an AI assistant button, job
listings, social sign-in (A45 forbids it), and upsell banners. A Hifdh streak could come later as
its own decision.

## 1. Tokens (F0)

| Role | Dark value | Use |
|---|---|---|
| `surface-bg` | `#0E1521` | Page background |
| `surface-raised` | `#18212F` | Cards, panels, top bar |
| `surface-sunken` | `#121A27` | Inputs, inset areas |
| `surface-rail` | `#26304A` | Side rail |
| `border` | `#34425C` | Card and table borders |
| `text-primary` / `text-secondary` | `#F1F4F8` / `#A6B0C0` | Text |
| `accent-primary` | `#F5922A` | Primary buttons, active tab, links |
| `accent-success` | `#3CC48A` | Paid, present, completed |
| `accent-warning` | `#F2C94C` | Late, grace period |
| `accent-danger` | `#E5676B` | Absent, rejected, errors |
| `accent-info` | `#A9C1F5` | Subject badges (light pill, dark text) |

The UI is **dark-only** for now (the reference is dark-only, and a light theme doubles every visual
check). A light theme is a later decision.

Typefaces, self-hosted through `next/font` (no new package): **Inter** for body text, **Lexend** for
headings, **Noto Naskh Arabic** for Arabic UI and Qur'anic text. Tashkīl rendering must be checked
with real Qur'anic samples before F3.

## 2. App shell (F1)

- **Desktop (≥ 900 px):** a fixed icon rail on the inline-start edge (icon above a short label, the
  active item highlighted with an accent bar), a top bar with the wordmark, language switcher and
  account, and the page content in a centred column.
- **Phone (< 900 px):** the rail is hidden; a **bottom navigation bar** of at most five items, the
  active one in a filled pill. Content gets bottom padding so the bar never covers it.
- **Role-aware items**, built server-side from the Actor (`src/server/navigation.ts`). Showing an
  item is convenience only — every page still checks authorization itself (CLAUDE.md rule 5).
- **RTL:** the rail moves to the right automatically; only logical CSS properties are used.
- Signed-out visitors see the top bar only, with a "Sign in" button.

## 3. Shared components (F1)

Plain CSS classes in `src/app/globals.css` (no UI library), so every existing page picks up the new
look without a rewrite:

`.button` (`-primary` orange pill, `-secondary` outline pill), `.card` (bordered, rounded),
`.card-grid`, `.badge` (pill; `-info`, `-success`, `-warning`, `-danger`, `-accent`), `.chip`
(status with dot), `.tabs` (with `.tab-count`), `.table` (header row, row dividers), `.progress`,
`.stat` (KPI tile), `.empty-state`, `.section-title`, form fields with focus ring. Icons are inline
SVGs in `src/components/icons.tsx`.

## 4. Pages by role (F2–F7)

| Role | Navigation | Key screens |
|---|---|---|
| Public | — | Sign in / Join / Invite as a split layout (welcome panel + form card; card only on phones). Landing page with hero and "Start" action. |
| Student | Home · Classes · Corrections · Account | **Home:** next class card ("Enter class" when live), "Continue" card with progress, attendance calendar in the side column, new corrections, payment status. **My classes:** cards with subject badge and status (Active / Grace / Pending payment / Waitlist). Class detail, Live Class, Corrections (audio clips). |
| Parent | Children · Account | One card per child; attendance shows Present/Absent and On time/Late, never timestamps (A131). |
| Teacher | Home · Classes · Corrections | **Home:** today's sessions with "Start session", waiting students. **Classes:** sortable table; class detail tabs Students · Sessions · Attendance · Corrections. Live view is whiteboard-first. |
| Finance Officer | Payments | Queue with tabs Pending (count) · Verified · Rejected; Verify / Reject on each row. |
| Markaz Admin | Dashboard · Classes · Payments · Account | **Dashboard:** KPI tiles (students, classes, seats left, payments pending). People (tabs by role), Join links (create, copy for WhatsApp, uses left), Parent links, Settings (time zone banner when unset). |
| Super Admin | Platform | Markaz table, "Open a Markaz", platform capacity ceilings. |

A person with several Markaz memberships gets the links of the Markaz in the URL (first Markaz elsewhere), plus a
Markaz switcher on the Markaz and finance pages (F5).

## 5. Phases

| Phase | Work | Status |
|---|---|---|
| F0 | Tokens, typefaces, decision record, this document | Done 2026-11-26 |
| F1 | App shell (rail, top bar, bottom nav), role-aware navigation, component classes | Done 2026-11-26 |
| F2 | Sign in / Join / Invite | Done 2026-11-26 (`42fe1a5`, deployed) |
| F3 | Student pages | Done 2026-11-26 (`be6405f`, deployed): home dashboard, class cards, student nav |
| F4 | Teacher pages | Done 2026-11-26 (`a4542e0`, deployed): teacher home, class page tabs. Live view waits on RTC (A35) |
| F5 | Markaz Admin + Finance Officer pages, Markaz switcher | Done 2026-11-26 (`10d6d30`, deployed) |
| F6 | Super Admin + Parent pages | Done 2026-11-26 (`e59934a`, deployed) |
| F7 | Landing page + footer | Done 2026-11-26 (deployed) |

**Rules for every phase:** UI only — no change to business logic, schema or authorization; every
string in the sw/en/ar dictionaries; each screen checked at 360 px, on desktop and in Arabic (RTL);
the existing test suite stays green.
