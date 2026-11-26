import type { ReactNode } from "react";
import type { NavKey } from "@/lib/navigation";

// Inline line icons (24×24, stroke = currentColor). Decorative: the label next to each icon
// carries the meaning, so every icon is aria-hidden.

const paths: Record<NavKey | "signIn" | "board", ReactNode> = {
  board: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20l4-4 4 4" />
      <path d="M7 9h6M7 12h9" />
    </>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  markaz: (
    <>
      <path d="M4 21V9l8-5 8 5v12" />
      <path d="M2.5 21h19" />
      <path d="M9 21v-5a3 3 0 0 1 6 0v5" />
      <path d="M12 8.5v.01" />
    </>
  ),
  classes: (
    <>
      <path d="M2.5 9 12 4.5 21.5 9 12 13.5Z" />
      <path d="M6.5 11v5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5" />
      <path d="M21.5 9v5" />
    </>
  ),
  payments: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
    </>
  ),
  platform: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
  signIn: (
    <>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l4-4-4-4" />
      <path d="M14 12H4" />
    </>
  ),
};

export function Icon({ name, size = 22 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
    >
      {paths[name]}
    </svg>
  );
}
