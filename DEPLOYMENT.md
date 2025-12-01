# Deployment Guide - Seichijunrei Bot

This guide explains how to deploy the Seichijunrei Bot to Google Vertex AI Agent Engine using the existing GitHub Actions workflow.

---

## Overview

The project includes a pre-configured GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys the agent to Google Cloud's Vertex AI Agent Engine.

**Deployment Features:**
- ✅ Automated deployment via GitHub Actions
- ✅ Support for staging and production environments
- ✅ Built-in health checks and smoke tests
- ✅ Easy rollback and cleanup

---

## Prerequisites

Before deploying, ensure you have:

1. **Google Cloud Project**
   - Active GCP project with billing enabled
   - Project ID ready (e.g., `my-seichijunrei-project`)

2. **Required APIs Enabled**
   - Vertex AI API
   - Cloud Storage API
   - Agent Engine API (part of Vertex AI)

3. **GitHub Repository**
   - Admin access to set repository secrets
   - Actions enabled

---

## Step 1: Set Up Google Cloud Project

### 1.1 Create or Select a GCP Project

```bash
# Create a new project (optional)
gcloud projects create YOUR_PROJECT_ID --name="Seichijunrei Bot"

# Set the project as default
gcloud config set project YOUR_PROJECT_ID
```

### 1.2 Enable Required APIs

```bash
# Enable Vertex AI and related APIs
gcloud services enable aiplatform.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
```

### 1.3 Create a Cloud Storage Bucket for Staging

```bash
# Create staging bucket (must be globally unique)
gsutil mb -l us-central1 gs://YOUR_PROJECT_ID-agent-staging
```

---

## Step 2: Create Service Account

### 2.1 Create Service Account

```bash
# Create service account for deployment
gcloud iam service-accounts create agent-deployer \
    --display-name="Agent Deployer" \
    --description="Service account for deploying ADK agents"
```

### 2.2 Grant Required Permissions

```bash
# Set project ID variable
export PROJECT_ID=YOUR_PROJECT_ID

# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agent-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agent-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agent-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"
```

### 2.3 Create and Download Service Account Key

```bash
# Create key file
gcloud iam service-accounts keys create agent-deployer-key.json \
    --iam-account=agent-deployer@$PROJECT_ID.iam.gserviceaccount.com

# Display the key content (copy this for GitHub Secrets)
cat agent-deployer-key.json
```

**⚠️ IMPORTANT:** Keep this key file secure and never commit it to Git!

---

## Step 3: Configure GitHub Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**

Click **New repository secret** and add the following:

### Required Secrets:

| Secret Name | Value | Description |
|------------|-------|-------------|
| `GCP_PROJECT_ID` | `your-project-id` | Your GCP project ID |
| `GCP_SA_KEY` | `{...json content...}` | Entire content of `agent-deployer-key.json` |

### Optional Secrets (for future features):

| Secret Name | Value | Description |
|------------|-------|-------------|
| `GOOGLE_MAPS_API_KEY` | `your-maps-key` | For future Maps integration |
| `WEATHER_API_KEY` | `your-weather-key` | For future weather features |

**How to add GCP_SA_KEY:**
1. Open `agent-deployer-key.json` in a text editor
2. Copy the **entire JSON content** (including `{` and `}`)
3. Paste it as the secret value in GitHub

---

## Step 4: Deploy Using GitHub Actions

### 4.1 Trigger Deployment Manually

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **"Deploy to Agent Engine"** workflow from the left sidebar
4. Click **"Run workflow"** button
5. Select environment:
   - **staging** - for testing
   - **production** - for final deployment
6. Click **"Run workflow"**

### 4.2 Monitor Deployment

The workflow will:
1. ✅ Install dependencies with `uv`
2. ✅ Authenticate to Google Cloud
3. ✅ Deploy agent to Vertex AI Agent Engine
4. ✅ Run smoke tests
5. ✅ Report success/failure

Check the workflow logs for deployment details and any errors.

---

## Step 5: Verify Deployment

### 5.1 Check Agent Engine Console

Visit the [Vertex AI Agent Engine Console](https://console.cloud.google.com/vertex-ai/agent-engine):

```
https://console.cloud.google.com/vertex-ai/agent-engine?project=YOUR_PROJECT_ID
```

You should see your deployed agent: `seichijunrei-bot-staging` or `seichijunrei-bot-production`

### 5.2 Test the Deployed Agent (CLI)

```bash
# Install ADK CLI locally
pip install google-adk

# Authenticate
gcloud auth application-default login

# Test the agent
adk chat \
  --project=YOUR_PROJECT_ID \
  --region=us-central1 \
  --agent=seichijunrei-bot-staging
```

### 5.3 Test via Web Interface

You can also test through the Vertex AI console's built-in chat interface.

---

## Step 6: Clean Up / Delete Deployment

### Option A: Via GitHub Actions (Recommended)

Add a cleanup step to the workflow or create a separate cleanup workflow.

### Option B: Via Cloud Console

1. Go to [Vertex AI Agent Engine Console](https://console.cloud.google.com/vertex-ai/agent-engine)
2. Find your agent (`seichijunrei-bot-staging` or `seichijunrei-bot-production`)
3. Click the three-dot menu → **Delete**
4. Confirm deletion

### Option C: Via CLI

```bash
# List deployed agents
gcloud ai agents list --region=us-central1

# Delete a specific agent
gcloud ai agents delete AGENT_ID --region=us-central1
```

**Note:** Deleting the agent will stop all costs associated with it.

---

## Cost Considerations

**Estimated Costs:**
- Vertex AI Agent Engine: Pay-per-use (Gemini API calls)
- Cloud Storage: Minimal (staging artifacts)
- Idle costs when not in use: **$0**

**Cost Control:**
- ✅ Set budget alerts in GCP Billing
- ✅ Delete staging deployments after testing
- ✅ Use `max_instances: 3-5` limit (already configured in `deploy/config.yaml`)

---

## Troubleshooting

### Error: "Please deploy from the project dir"

**Cause:** ADK expects to deploy from a specific directory structure

**Solution:**
Make sure you're deploying the `adk_agents` directory:
```bash
# Correct
adk deploy agent_engine ... adk_agents

# Incorrect
adk deploy agent_engine ... .
```

### Error: "Permission denied"

**Cause:** Service account lacks required permissions

**Solution:**
```bash
# Re-run Step 2.2 to grant permissions
# Verify permissions:
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:agent-deployer@*"
```

### Error: "Bucket does not exist"

**Cause:** Staging bucket not created

**Solution:**
```bash
# Create the bucket
gsutil mb -l us-central1 gs://YOUR_PROJECT_ID-agent-staging
```

### Error: "API not enabled"

**Cause:** Required APIs not enabled

**Solution:**
```bash
# Re-run Step 1.2
gcloud services enable aiplatform.googleapis.com storage.googleapis.com
```

---

## Deployment Architecture

```
GitHub Repository
       ↓
GitHub Actions (deploy.yml)
       ↓
Authenticate with Service Account
       ↓
ADK CLI Deploy
       ↓
Vertex AI Agent Engine (us-central1)
       ↓
Agent Available via:
  - ADK CLI
  - Vertex AI Console
  - API/SDK
```

---

## For Kaggle Competition Submission

**What to include in your writeup:**

1. ✅ Mention deployment capability in your README
2. ✅ Include this DEPLOYMENT.md in your GitHub repo
3. ✅ Screenshot of successful deployment (optional)
4. ✅ Reference the deploy workflow in `.github/workflows/deploy.yml`

**What NOT to do:**

- ❌ Don't keep the agent deployed 24/7 (costs money)
- ❌ Don't share your service account key publicly
- ❌ Don't commit API keys or credentials to Git

**Bonus Points:**
- Submitting with deployment documentation = +5 points
- No need to keep the agent running for evaluation

---

## Additional Resources

- [ADK Documentation](https://google.github.io/adk-docs/)
- [Vertex AI Agent Engine](https://cloud.google.com/agent-builder/agent-engine/overview)
- [ADK Deployment Guide](https://google.github.io/adk-docs/deploy/agent-engine/)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)

---

## Support

For deployment issues:
1. Check workflow logs in GitHub Actions
2. Review GCP error messages in Cloud Console
3. Consult [ADK Community](https://www.reddit.com/r/agentdevelopmentkit/)

---

**Ready to deploy?** Follow Step 1-4 above, then verify with Step 5!
