import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { liveTokenRouter } from "./routes/liveToken.js";
import { repoRouter } from "./routes/repo.js";
import { vivaRouter } from "./routes/viva.js";
import { reportRouter } from "./routes/report.js";
import { demoRouter, ensureDemo } from "./routes/demo.js";
import { recruiterRouter } from "./routes/recruiter.js";
import { attachLiveRelay } from "./live/relay.js";
import { storeKind } from "./store.js";
import { probeMainModel } from "./gemini.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", liveTokenRouter);
app.use("/api", repoRouter);
app.use("/api", vivaRouter);
app.use("/api", reportRouter);
app.use("/api", demoRouter);
app.use("/api", recruiterRouter);

// In production, serve the built frontend from the same container.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

const port = Number(process.env.PORT) || 8080;
const server = app.listen(port, () => {
  console.log(`Nirupi server on http://localhost:${port} (storage: ${storeKind})`);
  // Prepare the demo project in the background so "Try demo" is instant.
  void probeMainModel().finally(() => ensureDemo().catch(() => {}));
});

// Voice sessions for the viva and bug hunt run through the server (WebSocket at /api/live).
attachLiveRelay(server);
