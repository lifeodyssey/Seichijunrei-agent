"""
Deployment script for Seichijunrei Bot to Google Agent Engine.

This script handles the deployment process including:
- Initializing Vertex AI
- Creating the ADK application wrapper
- Deploying to Agent Engine
- Verifying the deployment

Usage:
    python deploy/deploy.py --project=my-project --env=staging
    python deploy/deploy.py --project=my-project --env=production
"""

import os
import sys
import argparse
import asyncio
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Deploy Seichijunrei Bot to Agent Engine")
    parser.add_argument(
        "--project",
        type=str,
        required=True,
        help="Google Cloud project ID"
    )
    parser.add_argument(
        "--region",
        type=str,
        default="us-central1",
        help="Google Cloud region (default: us-central1)"
    )
    parser.add_argument(
        "--env",
        type=str,
        choices=["staging", "production"],
        default="staging",
        help="Deployment environment (default: staging)"
    )
    parser.add_argument(
        "--bucket",
        type=str,
        help="GCS bucket for staging (default: gs://{project}-agent-staging)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print deployment plan without executing"
    )
    return parser.parse_args()


def deploy(args):
    """Deploy the agent to Agent Engine."""
    try:
        import vertexai
        from vertexai import agent_engines
    except ImportError:
        print("Error: google-cloud-aiplatform[adk,agent_engines] is required")
        print("Install with: pip install 'google-cloud-aiplatform[adk,agent_engines]>=1.111'")
        sys.exit(1)

    # Import root agent
    from agent import root_agent

    # Determine staging bucket
    staging_bucket = args.bucket or f"gs://{args.project}-agent-staging"
    display_name = f"seichijunrei-bot-{args.env}"

    print(f"\n{'=' * 60}")
    print("Seichijunrei Bot Deployment")
    print(f"{'=' * 60}")
    print(f"Project:      {args.project}")
    print(f"Region:       {args.region}")
    print(f"Environment:  {args.env}")
    print(f"Bucket:       {staging_bucket}")
    print(f"Display Name: {display_name}")
    print(f"{'=' * 60}\n")

    if args.dry_run:
        print("DRY RUN: Deployment plan created. Use without --dry-run to execute.")
        return

    # Initialize Vertex AI
    print("Initializing Vertex AI...")
    vertexai.init(
        project=args.project,
        location=args.region,
        staging_bucket=staging_bucket
    )

    # Create ADK application wrapper
    print("Creating ADK application...")
    app = agent_engines.AdkApp(
        agent=root_agent,
        enable_tracing=True
    )

    # Define requirements
    requirements = [
        "google-cloud-aiplatform[adk,agent_engines]>=1.111",
        "pydantic>=2.0.0",
        "aiohttp>=3.9.0",
        "httpx>=0.25.0",
        "googlemaps>=4.10.0",
        "folium>=0.15.0",
        "jinja2>=3.1.0",
        "structlog>=23.0.0",
    ]

    # Deploy to Agent Engine
    print("Deploying to Agent Engine...")
    remote_app = agent_engines.create(
        agent_engine=app,
        display_name=display_name,
        requirements=requirements,
    )

    print(f"\n{'=' * 60}")
    print("DEPLOYMENT SUCCESSFUL!")
    print(f"{'=' * 60}")
    print(f"Resource Name: {remote_app.resource_name}")
    print(f"\nTo test the deployed agent:")
    print(f"  from vertexai import agent_engines")
    print(f"  app = agent_engines.get('{remote_app.resource_name}')")
    print(f"  session = await app.async_create_session(user_id='test-user')")
    print(f"\nTo delete when no longer needed:")
    print(f"  remote_app.delete(force=True)")
    print(f"{'=' * 60}\n")

    return remote_app


async def verify_deployment(remote_app):
    """Verify the deployment with a simple test."""
    print("\nVerifying deployment...")

    try:
        # Create a test session
        session = await remote_app.async_create_session(user_id="deploy-test")
        print(f"  Created test session: {session['id']}")

        # Send a simple query
        response = []
        async for event in remote_app.async_stream_query(
            user_id="deploy-test",
            session_id=session["id"],
            message="Hello, can you help me plan a pilgrimage?"
        ):
            response.append(event)

        print(f"  Received {len(response)} response events")
        print("  Verification PASSED!")
        return True

    except Exception as e:
        print(f"  Verification FAILED: {e}")
        return False


def main():
    """Main entry point."""
    args = parse_args()

    # Validate environment
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        print("Warning: GOOGLE_APPLICATION_CREDENTIALS not set")
        print("Make sure you've authenticated with: gcloud auth application-default login")

    try:
        remote_app = deploy(args)

        if remote_app and not args.dry_run:
            # Run verification
            asyncio.run(verify_deployment(remote_app))

    except Exception as e:
        print(f"\nDeployment failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
