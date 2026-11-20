#!/usr/bin/env bash
# Deploy Nirupi to Google Cloud Run (asia-south1) with Firestore.
# Run from the project root in Google Cloud Shell (gcloud is pre-installed there):
#
#   export PROJECT_ID=your-gcp-project-id
#   export GEMINI_API_KEY=...            # required
#   export GITHUB_TOKEN=...              # recommended (git-history evidence)
#   export RECRUITER_KEY=...             # optional: leave unset to keep /recruiter open for judges
#   bash deploy/cloud-run.sh
#
# Safe to re-run: it updates secrets and redeploys.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project id}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-nirupi}"
DEMO_REPO_URL="${DEMO_REPO_URL:-https://github.com/Krishanth-07/portly}"
: "${GEMINI_API_KEY:?Set GEMINI_API_KEY (from aistudio.google.com/apikey)}"

echo "==> Project $PROJECT_ID, region $REGION, service $SERVICE"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Enabling APIs (first run takes a minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com >/dev/null

echo "==> Secrets"
SECRET_FLAGS=()
for NAME in GEMINI_API_KEY GITHUB_TOKEN RECRUITER_KEY; do
  VALUE="${!NAME:-}"
  if [ -z "$VALUE" ]; then echo "    $NAME not set, skipping"; continue; fi
  if gcloud secrets describe "$NAME" >/dev/null 2>&1; then
    printf %s "$VALUE" | gcloud secrets versions add "$NAME" --data-file=- >/dev/null
  else
    printf %s "$VALUE" | gcloud secrets create "$NAME" --data-file=- --replication-policy=automatic >/dev/null
  fi
  SECRET_FLAGS+=("$NAME=$NAME:latest")
  echo "    $NAME stored"
done

echo "==> Permissions for the Cloud Run service account"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role="roles/secretmanager.secretAccessor" --condition=None >/dev/null

echo "==> Building and deploying (Cloud Build uses the Dockerfile; ~5 minutes)"
# Why these flags:
#   --timeout 3600            voice sessions are long-lived WebSockets
#   --session-affinity        keep a student's requests on the same instance
#   --max-instances 1         the relay and local storage live in one process (fine for a prototype)
#   --min-instances 1         no cold start for judges; demo stays prepared
#   --no-cpu-throttling       background work (bug-hunt prep, git evidence) runs after responses
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --timeout 3600 \
  --session-affinity \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --cpu 1 \
  --memory 1Gi \
  --set-env-vars "DEMO_REPO_URL=$DEMO_REPO_URL" \
  --set-secrets "$(IFS=,; echo "${SECRET_FLAGS[*]}")"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "==> Live at: $URL"
echo "    Health:    $URL/api/health"
echo "    Recruiter: $URL/recruiter"
echo "    The demo project prepares itself on first start (about 30s)."
