import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Own port so other local projects on 5173 can't shadow Nirupi; fail loudly instead of hopping ports.
    port: 5180,
    strictPort: true,
    host: true, // listen on IPv4 + IPv6 so both localhost and 127.0.0.1 work on Windows
    // ws: true forwards the /api/live voice relay (WebSocket) to the server too.
    proxy: { "/api": { target: "http://localhost:8080", ws: true } },
  },
});
