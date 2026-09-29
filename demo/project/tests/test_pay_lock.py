import asyncio

import pytest

from checkout import app as app_module

pytestmark = pytest.mark.anyio


async def test_second_click_while_first_is_paying_gets_409(checkout):
    checkout.provider_delay = 0.2

    a, b = await checkout.clicks("o-1", 0, 0.05)

    assert (a.status_code, a.json()["status"]) == (200, "paid")
    assert (b.status_code, b.json()) == (409, {"status": "payment_in_progress"})
    assert len(checkout.charges) == 1


async def test_lock_is_per_order(checkout):
    checkout.provider_delay = 0.1

    (a,), (b,) = await asyncio.gather(checkout.clicks("o-1", 0), checkout.clicks("o-2", 0))

    assert a.json()["status"] == b.json()["status"] == "paid"
    assert len(checkout.charges) == 2


async def test_lock_is_released_when_charge_fails(checkout):
    checkout.provider_delay = 0.01
    checkout.provider_fails = True

    (first,) = await checkout.clicks("o-1", 0)
    assert first.status_code == 500
    assert await checkout.redis.exists("lock:pay:o-1") == 0  # not stuck for 30s

    checkout.provider_fails = False
    (retry,) = await checkout.clicks("o-1", 0)
    assert retry.json()["status"] == "paid"
    assert len(checkout.charges) == 1


async def test_lock_has_ttl_while_charging(checkout, monkeypatch):
    seen = {}

    async def charge_card(customer_id, amount_cents):
        seen["pttl"] = await checkout.redis.pttl("lock:pay:o-1")
        return await checkout.charge_card(customer_id, amount_cents)

    monkeypatch.setattr(app_module, "charge_card", charge_card)
    checkout.provider_delay = 0.01

    await checkout.clicks("o-1", 0)

    # -1 would mean "no expiry": a crashed worker would block this order forever.
    assert 0 < seen["pttl"] <= app_module.PAY_LOCK_TTL_S * 1000
