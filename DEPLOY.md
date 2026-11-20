# Deploying Nirupi

Nirupi runs as **one Cloud Run service** (API + voice relay over WebSocket + built frontend) with **Firestore** for data. Judges get a public HTTPS link; HTTPS is required for the microphone.

## What you need

- A Google Cloud project with billing enabled (hackathon credits work).
- Your Gemini API key, ideally from the **same project** with billing on (free-tier keys hit daily limits fast).
- Your GitHub token (for git-history evidence).

## Deploy from Google Cloud Shell (no installs needed)

1. Open <https://shell.cloud.google.com>.
2. Get the code into Cloud Shell, either:
   - **Upload:** click **⋮ → Upload**, choose `nirupi-source.zip`, then run `unzip nirupi-source.zip -d nirupi && cd nirupi`, or
   - **Git:** `git clone <your repo url> nirupi && cd nirupi`.
3. Run:

   ```bash
   export PROJECT_ID=your-gcp-project-id
   export GEMINI_API_KEY=your-gemini-key
   export GITHUB_TOKEN=your-github-token
   bash deploy/cloud-run.sh
   ```

4. The script prints the public link, like `https://nirupi-xxxxx-el.a.run.app`. Share that with judges.

Re-run the same script after any code change to redeploy.

## Settings

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Secret Manager | Required. All Gemini calls (server-side only). |
| `GITHUB_TOKEN` | Secret Manager | Git-history evidence (5,000 GitHub requests/hour instead of 60). |
| `RECRUITER_KEY` | Secret Manager | Optional. If set, `/recruiter` asks for it. Unset = open for judges. |
| `FIREBASE_PROJECT_ID` | Env var | Turns on Firestore (set automatically by the script). |
| `DEMO_REPO_URL` | Env var | Repo behind "Try the demo". |

## Notes

- **Firebase Hosting fallback:** Hosting rewrites can't carry WebSockets, so the voice relay must be reached on the Cloud Run URL directly. Use the Cloud Run link for the demo.
- **One instance:** the relay keeps live sessions in memory, so the service is pinned to a single always-on instance. That's right for a prototype; scaling out later needs shared session state.
- **Data:** locally, data is saved in `server/.data/`. In the cloud it's saved in Firestore collections `repos`, `vivas` and `reports`.
