"""Checkout service (simplified).

Deployed as 4 uvicorn workers x 3 replicas behind a load balancer.
Redis is already available (currently only used for session storage).
"""
from fastapi import FastAPI

from .db import get_order, mark_paid
from .payments import charge_card

app = FastAPI()


@app.post("/orders/{order_id}/pay")
async def pay(order_id: str):
    order = await get_order(order_id)
    if order.status == "paid":
        return {"status": "already_paid"}

    # Calls the payment provider; typically takes 300-900ms.
    receipt = await charge_card(order.customer_id, order.amount_cents)

    await mark_paid(order_id, receipt.id)
    return {"status": "paid", "receipt": receipt.id}
