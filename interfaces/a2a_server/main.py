"""A2A Server entry point for uvicorn.

Usage:
    uv run uvicorn interfaces.a2a_server.main:app --port 8080 --reload

Or via Makefile:
    make a2a
"""

from .server import create_app

# Create the ASGI application
app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "interfaces.a2a_server.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
