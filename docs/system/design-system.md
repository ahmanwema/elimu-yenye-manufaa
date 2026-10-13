# Design System

Status: **PROPOSED** direction; final palette/typography subject to approval (per brief Part 10). Codefinity screenshots referenced in the brief were **not found** in this repository (`references/ui/` does not exist) — this document is written from the brief's own written requirements, as instructed for that fallback case.

## 1. Design principles (original identity, inspired-by not copied-from)

- **Calm, focused, dark-first educational interface** — reduces eye strain for long recitation/study sessions, consistent with the "dark educational interface" direction requested, but with an original palette, not Codefinity's branding or graphics.
- **Card-based course/lesson browsing** with clear visual hierarchy between "what's next," "in progress," and "completed."
- **Arabic-first typographic respect**: Arabic text is never an afterthought skin on a Latin layout — RTL and tashkīl rendering are first-class, not a mirrored CSS hack applied late.
- **Teacher tools prioritize the whiteboard**: on desktop, the teacher's chrome recedes so the writing surface gets maximum space (per brief 10.1).

## 2. Placeholder design tokens (PROPOSED, not final)

These are structural placeholders to let component specs reference consistent names — exact hex/type values are subject to approval and intentionally not over-specified here.

- Color roles needed: `surface-bg`, `surface-raised`, `text-primary`, `text-secondary`, `accent-primary` (brand), `accent-success` (progress/completion), `accent-warning` (raised-hand/attention), `accent-danger` (errors, revoked permission), each with light and dark values.
- Typography roles: `font-latin` (Swahili/English body), `font-arabic` (Qur'anic/Arabic text — must support tashkīl correctly, e.g. an Amiri/Noto Naskh Arabic-class typeface, final choice pending approval), `font-mono` (code/reference only if ever needed).
- Spacing/radius scale: a standard 4/8px-based scale, final values pending a visual design pass.

## 3. RTL and Arabic typography requirements

- Any screen containing Arabic script text must support right-to-left text direction for that content region, independent of the overall UI language (a Swahili-UI screen can still contain an RTL Qur'an-text panel).
- Tashkīl (diacritics: fatha, kasra, damma, shadda, etc.) must render correctly — this constrains font choice and requires testing actual Qur'anic text samples, not lorem-ipsum Arabic.
- Reading sizes must be adjustable/accessible — Qur'an/Hifdh review is a sustained-reading use case, not a glance-and-move-on one.
- Mixed-direction UI (e.g. an English button label inside an RTL content panel) must be tested explicitly — this is a common source of layout bugs and is called out in [../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md).

## 4. Layout direction by device class

### 4.1 Desktop (brief 10.1)
- Sidebar navigation + main learning area, course cards, progress, upcoming lessons.
- Teacher view: whiteboard/document viewer takes primary screen real estate; annotation toolbar is compact and always reachable, not competing with the writing surface for space.

### 4.2 Tablet (brief 10.2)
- Adaptive width use in both portrait and landscape; do not artificially shrink the teaching/whiteboard content to preserve a desktop-style sidebar — the sidebar should collapse/overlay instead.

### 4.3 Mobile (brief 10.3)
- Bottom navigation for major sections (not a shrunk desktop sidebar).
- Touch-friendly controls sized for finger input, not mouse-precision assumptions.
- Whiteboard viewing supports a fullscreen mode, since screen space is the scarce resource on a phone.
- Course cards and controls redesigned for a single-column, thumb-reachable layout — this is a distinct layout, not a scaled-down desktop one (explicit brief requirement, Part 10.3).

## 5. Wireframe status

Full desktop/tablet/mobile wireframes for the Live Class lesson page are described structurally in [../features/live-class.md](../features/live-class.md) §UI states and [../components/live-class-layout.md](../components/live-class-layout.md); this repository does not yet contain pixel-level visual mockups (no design tool output exists in `references/ui/`) — producing those is a follow-on task once this direction is approved.

## 6. What is explicitly NOT done here

No color hex values, no font files, no logo, and no Codefinity asset are included or referenced beyond written description — consistent with the "do not copy Codefinity branding/graphics" instruction.
