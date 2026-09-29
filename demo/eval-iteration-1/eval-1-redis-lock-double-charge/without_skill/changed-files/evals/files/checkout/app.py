"""Checkout service (simplified).

Deployed as 4 uvicorn workers x 3 replicas behind a load balancer.
Redis is already available (currently only used for session storage).
"""
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .db import claim_for_payment, get_order, mark_paid, release_claim
from .payments import charge_card

app = FastAPI()


@app.post("/orders/{order_id}/pay")
async def pay(order_id: str):
    # Flip the order from "pending" to "paying" in one atomic statement.
    # Only one request can win this, even if two clicks land on different
    # workers or machines, so only one request ever reaches charge_card.
    order = await claim_for_payment(order_id)
    if order is None:
        current = await get_order(order_id)
        if current.status == "paid":
            return {"status": "already_paid"}
        # Another request (usually the first click) is charging right now.
        return JSONResponse(status_code=409, content={"status": "payment_in_progress"})

    try:
        # Calls the payment provider; typically takes 300-900ms.
        receipt = await charge_card(order.customer_id, order.amount_cents)
    except Exception:
        # The charge failed, so put the order back to "pending" and let the
        # customer try again. Caveat: after a timeout we can't be sure the
        # provider didn't charge. Closing that gap needs an idempotency key
        # on the charge request, not a lock.
        await release_claim(order_id)
        raise

    await mark_paid(order_id, receipt.id)
    return {"status": "paid", "receipt": receipt.id}
