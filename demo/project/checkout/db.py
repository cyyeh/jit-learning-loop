from dataclasses import dataclass

from .pg import pool  # asyncpg pool


@dataclass
class Order:
    id: str
    customer_id: str
    amount_cents: int
    status: str  # "pending" | "paid"


async def get_order(order_id: str) -> Order:
    row = await pool.fetchrow(
        "SELECT id, customer_id, amount_cents, status FROM orders WHERE id = $1",
        order_id,
    )
    return Order(**row)


async def mark_paid(order_id: str, receipt_id: str) -> None:
    await pool.execute(
        "UPDATE orders SET status = 'paid', receipt_id = $2 WHERE id = $1",
        order_id,
        receipt_id,
    )
