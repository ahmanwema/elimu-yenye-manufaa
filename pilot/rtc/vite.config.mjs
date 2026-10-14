import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// HTTPS is required for microphone access on phones (getUserMedia needs a secure context).
// A self-signed certificate is used for LAN tests: accept the browser warning on each device.
export default defineConfig({
  root: ".",
  plugins: [basicSsl()],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
