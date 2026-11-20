# Nirupi: prove you built it

A student pastes a public GitHub repo. Gemini reads the code and asks three questions about specific lines in a **live voice viva**, then hides one small bug in the student's own function for a 3-minute **bug hunt**. The result is a shareable report that scores **technical understanding** and **communication** separately, with the student's own words as evidence.

Built with the Gemini API only: `gemini-3.8-flash` (with `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` fallbacks) for analysis and scoring, and `gemini-3.8-live` for voice.

## Run it

```bash
npm install
npm run build
npm start            # serves the app, API and voice relay on $PORT (default 8080)
```

For development with hot reload: `npm run dev` (web on :5180, API on :8080).

### Settings (environment variables / secrets)

| Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | All Gemini calls. Used server-side only. |
| `GITHUB_TOKEN` | Recommended | Git-history evidence (5,000 GitHub requests/hour instead of 60). |
| `DEMO_REPO_URL` | No | Repo behind "Try the demo" (default: expressjs/express). |
| `RECRUITER_KEY` | No | If set, `/recruiter` asks for it. |
| `FIREBASE_PROJECT_ID` + `FIREBASE_SERVICE_ACCOUNT` | No | Store data in Firestore. Without them, data is saved to local disk. |

## Structure

- `server/`: Express + TypeScript. The API, Gemini calls, and the voice relay at `/api/live` (WebSocket).
- `web/`: React + Vite + Tailwind frontend. Built to `web/dist` and served by the server in production.
- `metadata.json`: asks the browser for microphone access (needed inside Google AI Studio).

## Notes for Google AI Studio

- Keep this structure: it's an npm workspaces app (`server` + `web`). `npm run build` then `npm start` runs everything from one Node process on `$PORT`.
- `GEMINI_API_KEY` comes from AI Studio's Secrets panel. Add `GITHUB_TOKEN` and `DEMO_REPO_URL` there too.
- The voice viva needs WebSockets (`/api/live`) and the microphone (declared in `metadata.json`).
- Don't move Gemini calls to the browser: transcripts and scores must stay server-side, so students can't tamper with them.

## Integrity

The voice session runs through the server, so transcripts are recorded server-side. Expected answers and the bug-hunt solution never reach the browser. The bug-hunt clock runs on the server. Tab switches, full-screen exits and paste attempts are recorded and shown neutrally. AI collects evidence; humans make hiring decisions.
