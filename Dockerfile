# Nirupi: one container serving the API, the voice relay (WebSocket) and the built frontend.

# ---------- build ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
# `npm install` (not `ci`) so Linux-only native binaries (esbuild, rolldown, lightningcss) are resolved
# even though the lockfile was generated on Windows.
RUN npm install --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build

# ---------- runtime ----------
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --omit=dev --workspace server --include-workspace-root=false --no-audit --no-fund
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# The app runs as the unprivileged "node" user; give it a writable folder for the local
# data fallback (used when Firestore isn't configured).
RUN mkdir -p server/.data && chown -R node:node server/.data
# Cloud Run / Hugging Face Spaces route to this port (Cloud Run may override PORT).
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/dist/index.js"]
