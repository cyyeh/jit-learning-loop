"""In-memory fakes so the checkout flow runs without Postgres, Redis or the payment provider."""
import asyncio
import contextvars
import sys
import time
import types
from dataclasses import dataclass, field, replace

import fakeredis
import httpx
import pytest

# checkout/db.py does `from .pg import pool`; pg.py isn't in this repo, and the
# tests replace get_order / mark_paid anyway, so a stub module is enough.
sys.modules.setdefault("checkout.pg", types.ModuleType("checkout.pg"))
sys.modules["checkout.pg"].pool = None

from checkout import app as app_module  # noqa: E402
from checkout.db import Order  # noqa: E402
from checkout.payments import Receipt  # noqa: E402

# Which simulated click ("A" / "B") the current code is running for.
who = contextvars.ContextVar("who", default="-")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@dataclass
class Checkout:
    """One order, one fake provider, a fake Redis, and a timeline of what happened."""

    provider_delay: float = 0.5
    provider_fails: bool = False
    orders: dict = field(default_factory=dict, repr=False)
    charges: list = field(default_factory=list)
    timeline: list = field(default_factory=list, repr=False)
    redis: object = field(default=None, repr=False)
    _t0: float = field(default_factory=time.perf_counter, repr=False)

    def log(self, msg: str) -> None:
        ms = (time.perf_counter() - self._t0) * 1000
        self.timeline.append(f"{ms:7.0f}ms  {who.get()}  {msg}")

    def print_timeline(self) -> None:
        print("\n" + "\n".join(self.timeline))

    # --- fake checkout.db -------------------------------------------------
    async def get_order(self, order_id: str) -> Order:
        await asyncio.sleep(0.002)  # DB round-trip
        order = replace(self.orders[order_id])
        self.log(f"get_order -> status={order.status}")
        return order

    async def mark_paid(self, order_id: str, receipt_id: str) -> None:
        await asyncio.sleep(0.002)
        self.orders[order_id].status = "paid"
        self.log(f"mark_paid({receipt_id})")

    # --- fake checkout.payments --------------------------------------------
    async def charge_card(self, customer_id: str, amount_cents: int) -> Receipt:
        self.log("charge_card: request sent to provider")
        await asyncio.sleep(self.provider_delay)
        if self.provider_fails:
            self.log("charge_card: provider error, nothing charged")
            raise httpx.ConnectError("provider unavailable")
        self.charges.append((customer_id, amount_cents))
        receipt = Receipt(id=f"ch_{len(self.charges)}")
        self.log(f"charge_card: CHARGED {amount_cents} -> {receipt.id}")
        return receipt

    # --- driving the endpoint ----------------------------------------------
    async def click(self, client, order_id: str, name: str, after: float):
        await asyncio.sleep(after)
        who.set(name)
        self.log(f"POST /orders/{order_id}/pay")
        resp = await client.post(f"/orders/{order_id}/pay")
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
        self.log(f"<- {resp.status_code} {body}")
        return resp

    async def clicks(self, order_id: str, *at: float):
        """Fire one request per offset in `at` (seconds), concurrently."""
        transport = httpx.ASGITransport(app=app_module.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await asyncio.gather(
                *(self.click(client, order_id, "ABCDEFGH"[i], t) for i, t in enumerate(at))
            )


@pytest.fixture
def checkout(monkeypatch):
    c = Checkout()
    c.orders["o-1"] = Order(id="o-1", customer_id="cus-1", amount_cents=4200, status="pending")
    c.orders["o-2"] = Order(id="o-2", customer_id="cus-2", amount_cents=1000, status="pending")
    c.redis = fakeredis.FakeAsyncRedis()
    monkeypatch.setattr(app_module, "get_order", c.get_order)
    monkeypatch.setattr(app_module, "mark_paid", c.mark_paid)
    monkeypatch.setattr(app_module, "charge_card", c.charge_card)
    # raising=False: before the fix, app.py has no `redis` at all.
    monkeypatch.setattr(app_module, "redis", c.redis, raising=False)
    return c
