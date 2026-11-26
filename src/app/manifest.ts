import type { MetadataRoute } from "next";

// Icons in public/icons are built from the owner's logo (A155); do NOT re-run
// scripts/generate-placeholder-icons.mjs, which would overwrite them with placeholders.
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
    background_color: "#03174C",
    theme_color: "#0E1521",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
