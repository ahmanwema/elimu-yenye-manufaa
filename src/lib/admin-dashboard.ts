// Pure helpers for the Markaz Admin overview (ui-plan §4, F5). Presentation only.

type JoinLinkLike = { status: "ACTIVE" | "REVOKED"; expiresAt: Date; maxUses: number | null; useCount: number };

/** A join link someone could still use right now: active, not expired, uses left. */
export function isOpenJoinLink(link: JoinLinkLike, now: Date): boolean {
  return link.status === "ACTIVE" && link.expiresAt.getTime() > now.getTime() && (link.maxUses === null || link.useCount < link.maxUses);
}

export function countOpenJoinLinks(links: readonly JoinLinkLike[], now: Date): number {
  return links.filter((l) => isOpenJoinLink(l, now)).length;
}
