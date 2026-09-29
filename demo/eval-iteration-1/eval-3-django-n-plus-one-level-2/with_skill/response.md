You're right that it's an N+1, and both of your fixes are correct. There's still a gap, though: the page has a third relation that your plan doesn't cover. You brought your own plan this time, so I'll critique it and leave the fix to you.

## What this task needs
Have: the N+1 pattern, and when to use `select_related` vs `prefetch_related` (from the invoices fix)
Missing: nested relations. That means a relation you follow *inside* a prefetched collection (concept), and how to write a prefetch that goes more than one level deep (API).

## What's right
- **`select_related('customer')`:** `order.customer` is a forward FK, so each order has exactly one customer. A JOIN pulls it into the orders query without adding rows. Right tool.
- **`prefetch_related('items')`:** `order.items` is the reverse side of `OrderItem.order`, so each order has many items. A JOIN would repeat each order once per item. Instead, Django runs one extra query (`WHERE order_id IN (…the 50 ids…)`) and attaches the items to their orders in Python. Right tool.
- **Putting it in the view:** the queries *run* in the template, but the view's queryset decides what gets loaded up front. Right place.

## What's missing
Line 9 of `templates/orders/list.html`:

```django
{% for item in order.items.all %}
<li>{{ item.quantity }} × {{ item.product.name }}</li>
```

`item.product` is another FK, one level deeper. `prefetch_related('items')` loads the `OrderItem` rows, but each item's `product` is still fetched lazily. So the page still has an N+1. It has just moved into the inner loop, and now it costs one query per *item* instead of one per order.

The habit that catches this: to find the relations, read the template (that's where the queries happen), not the view. Any `.` inside a `{% for %}` that follows a relation to another model can be a query, and that includes the inner loops.

## Your turn
1. **Predict:** say the page shows 50 orders with 3 items each. How many queries does it run today, and how many with your plan exactly as written?
2. **Revise:** how would you change the plan to cover `item.product`? Say which tool you'd use and why it fits the kind of relation `product` is. There's more than one reasonable answer.

One line for each is fine. Once you have a version, I'll count the real queries against some seeded data so you can check your numbers. Then we'll pin the count with a test so a later template change can't quietly bring the N+1 back.
