"""Firestore session store implementation.

Provides distributed session storage using Google Cloud Firestore.
Requires the 'google-cloud-firestore' package to be installed.
"""

from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)


class FirestoreSessionStore:
    """Firestore-backed session store for GCP deployments.

    Provides persistent, distributed session storage using
    Google Cloud Firestore.
    """

    def __init__(
        self,
        project_id: str | None = None,
        collection_name: str = "sessions",
    ) -> None:
        """Initialize the Firestore session store.

        Args:
            project_id: GCP project ID. If None, uses default.
            collection_name: Firestore collection name for sessions.
        """
        self._project_id = project_id
        self._collection_name = collection_name
        self._client: Any = None

    def _get_client(self) -> Any:
        """Get or create Firestore client (lazy initialization)."""
        if self._client is None:
            try:
                from google.cloud import firestore
            except ImportError as e:
                raise ImportError(
                    "google-cloud-firestore package is required. "
                    "Install with: pip install google-cloud-firestore"
                ) from e

            self._client = firestore.AsyncClient(project=self._project_id)
            logger.info(
                "Firestore client initialized",
                project_id=self._project_id,
                collection=self._collection_name,
            )
        return self._client

    def _get_collection(self) -> Any:
        """Get the sessions collection reference."""
        return self._get_client().collection(self._collection_name)

    async def get(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve session state by ID."""
        collection = self._get_collection()
        doc_ref = collection.document(session_id)
        doc = await doc_ref.get()

        if not doc.exists:
            return None

        data = doc.to_dict()
        logger.debug("Session retrieved from Firestore", session_id=session_id)

        # Return just the state portion
        return data.get("state", {})

    async def set(self, session_id: str, state: dict[str, Any]) -> None:
        """Store or update session state."""
        from datetime import UTC, datetime

        collection = self._get_collection()
        doc_ref = collection.document(session_id)

        await doc_ref.set(
            {
                "state": state,
                "updated_at": datetime.now(UTC),
            },
            merge=True,
        )

        logger.debug("Session stored in Firestore", session_id=session_id)

    async def delete(self, session_id: str) -> None:
        """Delete a session."""
        collection = self._get_collection()
        doc_ref = collection.document(session_id)

        await doc_ref.delete()
        logger.debug("Session deleted from Firestore", session_id=session_id)

    async def exists(self, session_id: str) -> bool:
        """Check if a session exists."""
        collection = self._get_collection()
        doc_ref = collection.document(session_id)
        doc = await doc_ref.get()
        return doc.exists

    async def close(self) -> None:
        """Close the Firestore client."""
        if self._client is not None:
            self._client.close()
            self._client = None
            logger.info("Firestore client closed")
