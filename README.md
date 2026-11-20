# Nirupi: hire for real understanding

**Nirupi helps companies hire skilful students and freshers by interviewing them on their own code.**

## The problem

Hiring students is guesswork. CVs list the same courses, grades say little about engineering skill, and a GitHub link only shows that a project *exists*. Now that AI can write a whole project in an afternoon, a portfolio no longer shows whether the candidate understands what's in it. Teams end up spending engineer hours on first-round interviews just to find out.

## What Nirupi does

1. **The candidate connects a public GitHub repo.** Gemini reads the code and picks three specific lines worth discussing.
2. **A live voice viva.** A calm AI interviewer asks *why* the code works the way it does and *what would break if* it changed, with adaptive follow-ups. Then the candidate fixes one small bug planted in their own function, explaining aloud, in three minutes.
3. **The hiring team gets an evidence-backed report.** Technical understanding and communication are scored separately, so accent or fluency never lowers the technical score. Every score is backed by the candidate's own quotes, alongside git-history evidence and exam-integrity signals. All assessments land in a sortable **hiring dashboard**.

Candidates can also **practise first**: the same viva, privately, with a "what to practise next" list. Practice reports are never shown to companies.

**AI collects evidence; humans make hiring decisions.**

## Built with Gemini

- `gemini-3.8-flash` reads the code, writes the questions and the bug hunt, and scores the viva, all with structured JSON output. `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite` are automatic fallbacks.
- `gemini-3.8-live` runs the spoken interview, relayed through the server so transcripts can't be tampered with.

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

## Fair, hard-to-game assessments

- The voice session runs through the server, so transcripts are recorded server-side and can't be edited from the browser. Only spoken answers are accepted.
- Expected answers and the bug-hunt solution never reach the browser, and the bug-hunt clock runs on the server.
- In an assessment, switching tabs or apps, leaving full screen, going back, or pasting into the editor counts as a violation. Two warnings, then the third ends the viva and flags the report. In practice mode these only warn.
- Violations are reported neutrally as integrity signals, never as accusations.
