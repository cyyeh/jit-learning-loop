from dataclasses import dataclass

from .pg import pool  # asyncpg pool


@dataclass
class Order:
    id: str
    customer_id: str
    amount_cents: int
    status: str  # "pending" | "paying" | "paid"


async def get_order(order_id: str) -> Order:
    row = await pool.fetchrow(
        "SELECT id, customer_id, amount_cents, status FROM orders WHERE id = $1",
        order_id,
    )
    return Order(**row)


async def claim_for_payment(order_id: str) -> Order | None:
    """Atomically move an order from 'pending' to 'paying'.

    This is the "lock". The check (is it pending?) and the write (mark it as
    being paid) happen in one statement, so Postgres lets exactly one caller
    win, no matter how many workers or replicas send it at the same moment.
    Everyone else gets 0 rows back.

    Returns the order if this caller won, or None if the order was not
    pending (already paid, or another request is paying it right now).
    """
    row = await pool.fetchrow(
        """
        UPDATE orders SET status = 'paying'
        WHERE id = $1 AND status = 'pending'
        RETURNING id, customer_id, amount_cents, status
        """,
        order_id,
    )
    return Order(**row) if row else None


async def release_claim(order_id: str) -> None:
    """Undo claim_for_payment after a failed charge so the customer can retry."""
    await pool.execute(
        "UPDATE orders SET status = 'pending' WHERE id = $1 AND status = 'paying'",
        order_id,
    )


async def mark_paid(order_id: str, receipt_id: str) -> None:
    await pool.execute(
        "UPDATE orders SET status = 'paid', receipt_id = $2 WHERE id = $1",
        order_id,
        receipt_id,
    )
