from dataclasses import dataclass

import httpx


@dataclass
class Receipt:
    id: str


async def charge_card(customer_id: str, amount_cents: int) -> Receipt:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://payments.internal/v1/charges",
            json={"customer": customer_id, "amount": amount_cents},
        )
        resp.raise_for_status()
        return Receipt(id=resp.json()["id"])
