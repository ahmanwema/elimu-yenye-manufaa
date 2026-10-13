import type { MetadataRoute } from "next";

// Icons in public/icons are generated PLACEHOLDERS (scripts/generate-placeholder-icons.mjs).
// Final brand icons are a design deliverable — see docs/system/pwa.md.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Elimu Yenye Manufaa",
    short_name: "Elimu",
    description: "Online Islamic education platform for teachers, Markaz and students.",
    start_url: "/",
    lang: "sw",
    dir: "auto",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#10151b",
    theme_color: "#10151b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
