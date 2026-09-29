import os

from redis.asyncio import Redis

# Every worker on every replica must point at the *same* Redis (the primary),
# or the pay lock in app.py protects nothing. Reuse the Redis the session
# storage already talks to.
redis = Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
