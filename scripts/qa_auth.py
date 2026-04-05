"""Generate a magic link for QA testing without sending email.

Uses Supabase Admin API (generateLink) to produce a valid magic link URL
that a headless browser can visit directly. No real email needed.

Usage:
    # With .env.test file:
    python scripts/qa_auth.py

    # With environment variables:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... QA_USER_EMAIL=... python scripts/qa_auth.py

    # Output: the magic link URL (visit it in a browser to log in)

Requires: httpx (already in project deps)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _load_env_test() -> None:
    """Load .env.test if it exists (no external deps needed)."""
    env_file = Path(__file__).resolve().parent.parent / ".env.test"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and value and key not in os.environ:
            os.environ[key] = value


def generate_magic_link(
    supabase_url: str,
    service_role_key: str,
    email: str,
    redirect_to: str = "/",
) -> str:
    """Call Supabase Admin API to generate a magic link without sending email.

    Returns the full magic link URL (contains token_hash).
    """
    # Clear proxy env vars before importing httpx (it reads them at init time)
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        os.environ.pop(var, None)
    import httpx

    client = httpx.Client(timeout=15)
    resp = client.post(
        f"{supabase_url}/auth/v1/admin/generate_link",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        },
        json={
            "type": "magiclink",
            "email": email,
            "options": {"redirect_to": redirect_to},
        },
    )
    resp.raise_for_status()
    data = resp.json()

    # The response contains action_link (top-level or under properties)
    action_link = data.get("action_link") or data.get("properties", {}).get("action_link")
    if not action_link:
        # Fallback: construct from hashed_token
        hashed_token = data.get("hashed_token") or data.get("properties", {}).get("hashed_token", "")
        if hashed_token:
            action_link = (
                f"{supabase_url}/auth/v1/verify"
                f"?token={hashed_token}&type=magiclink&redirect_to={redirect_to}"
            )
        else:
            print("Error: No action_link or hashed_token in response", file=sys.stderr)
            print(f"Response: {data}", file=sys.stderr)
            sys.exit(1)

    return str(action_link)


def main() -> None:
    _load_env_test()

    supabase_url = os.environ.get("SUPABASE_URL", "")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    email = os.environ.get("QA_USER_EMAIL", "qa-bot@seichijunrei.test")
    site_url = os.environ.get("QA_SITE_URL", "")

    if not supabase_url or not service_role_key:
        print(
            "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n"
            "Set them in .env.test or as environment variables.\n"
            "See .env.test.example for the template.",
            file=sys.stderr,
        )
        sys.exit(1)

    redirect_to = site_url.strip() if site_url else "/"
    link = generate_magic_link(supabase_url, service_role_key, email, redirect_to)
    print(link.strip())


if __name__ == "__main__":
    main()
