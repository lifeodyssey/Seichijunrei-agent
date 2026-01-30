"""Redis session store implementation.

Provides distributed session storage using Redis.
Requires the 'redis' package to be installed.
"""

from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)


class RedisSessionStore:
    """Redis-backed session store for distributed deployments.

    Provides persistent, distributed session storage with automatic
    expiration support via Redis TTL.
    """

    def __init__(
        self,
        host: str = "localhost",
        port: int = 6379,
        db: int = 0,
        password: str | None = None,
        prefix: str = "session:",
        ttl_seconds: int = 3600,
    ) -> None:
        """Initialize the Redis session store.

        Args:
            host: Redis server hostname.
            port: Redis server port.
            db: Redis database number.
            password: Optional Redis password.
            prefix: Key prefix for session keys.
            ttl_seconds: Default TTL for sessions.
        """
        self._host = host
        self._port = port
        self._db = db
        self._password = password
        self._prefix = prefix
        self._ttl_seconds = ttl_seconds
        self._client: Any = None

    async def _get_client(self) -> Any:
        """Get or create Redis client (lazy initialization)."""
        if self._client is None:
            try:
                import redis.asyncio as redis
            except ImportError as e:
                raise ImportError(
                    "redis package is required for RedisSessionStore. "
                    "Install with: pip install redis"
                ) from e

            self._client = redis.Redis(
                host=self._host,
                port=self._port,
                db=self._db,
                password=self._password,
                decode_responses=True,
            )
            logger.info(
                "Redis client initialized",
                host=self._host,
                port=self._port,
                db=self._db,
            )
        return self._client

    def _make_key(self, session_id: str) -> str:
        """Create Redis key from session ID."""
        return f"{self._prefix}{session_id}"

    async def get(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve session state by ID."""
        import json

        client = await self._get_client()
        key = self._make_key(session_id)

        data = await client.get(key)
        if data is None:
            return None

        # Refresh TTL on access
        await client.expire(key, self._ttl_seconds)
        logger.debug("Session retrieved from Redis", session_id=session_id)

        return json.loads(data)

    async def set(self, session_id: str, state: dict[str, Any]) -> None:
        """Store or update session state."""
        import json

        client = await self._get_client()
        key = self._make_key(session_id)

        await client.setex(
            key,
            self._ttl_seconds,
            json.dumps(state),
        )
        logger.debug("Session stored in Redis", session_id=session_id)

    async def delete(self, session_id: str) -> None:
        """Delete a session."""
        client = await self._get_client()
        key = self._make_key(session_id)

        await client.delete(key)
        logger.debug("Session deleted from Redis", session_id=session_id)

    async def exists(self, session_id: str) -> bool:
        """Check if a session exists."""
        client = await self._get_client()
        key = self._make_key(session_id)
        return bool(await client.exists(key))

    async def close(self) -> None:
        """Close the Redis connection."""
        if self._client is not None:
            await self._client.close()
            self._client = None
            logger.info("Redis client closed")
