For 50ms I'd guess **1 charge**? FastAPI is async, and isn't asyncio single-threaded? A single process should only be running one request at a time, so there's no race within the same process, and it only goes wrong when the two requests get sent to different processes. At 1 second apart it should just be 1 charge.

I checked one case in prod: the two charges were about 180ms apart, and the first request returned 200. I looked at `pg.py`: the pool connects to the primary, not a replica.
