"""Checkout service (simplified).

Deployed as 4 uvicorn workers x 3 replicas behind a load balancer.
Redis is already available (currently only used for session storage).
"""
import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from redis.exceptions import LockNotOwnedError

from .db import get_order, mark_paid
from .payments import charge_card
from .redis_client import redis

logger = logging.getLogger(__name__)

app = FastAPI()

# The lock must outlive the slowest pay() call. If it expires while charge_card
# is still running, a second click can get in and charge again.
# charge_card uses httpx's default 5s timeouts, so 30s leaves a wide margin.
PAY_LOCK_TTL_S = 30


@app.post("/orders/{order_id}/pay")
async def pay(order_id: str):
    # At most one pay() per order at a time, across all workers and replicas.
    lock = redis.lock(f"lock:pay:{order_id}", timeout=PAY_LOCK_TTL_S, blocking=False)
    if not await lock.acquire():
        # Another click is already paying this order; its result is the answer.
        return JSONResponse(status_code=409, content={"status": "payment_in_progress"})

    try:
        # The status check must happen *inside* the lock. Checking before
        # acquiring it reopens the same check-then-act race.
        order = await get_order(order_id)
        if order.status == "paid":
            return {"status": "already_paid"}

        # Calls the payment provider; typically takes 300-900ms.
        receipt = await charge_card(order.customer_id, order.amount_cents)

        await mark_paid(order_id, receipt.id)
        return {"status": "paid", "receipt": receipt.id}
    finally:
        try:
            await lock.release()
        except LockNotOwnedError:
            # The TTL ran out before we finished, so another request may have
            # charged this order too. Our charge already happened; don't turn
            # it into a 500, but make it loud.
            logger.error(
                "pay lock for order %s expired before release (TTL %ss): possible double charge",
                order_id,
                PAY_LOCK_TTL_S,
            )
