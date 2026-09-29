You're right about the two relations you spotted. There's a third one in the template, though, so your plan only fixes part of the problem.

**What you got right**

- `order.customer.name` is a forward ForeignKey: each order points to one customer. `select_related('customer')` is correct. It JOINs the customer into the orders query.
- `order.items.all` is a reverse FK: one order has many items. `prefetch_related('items')` is correct. It loads all the items in one extra query.

**What you missed**

Line 9 of `templates/orders/list.html`:

```django
<li>{{ item.quantity }} × {{ item.product.name }}</li>
```

`item.product` is a second ForeignKey, one level deeper, on `OrderItem`. `prefetch_related('items')` loads the items but not their products, so every item still runs its own `SELECT ... FROM product`. The N+1 doesn't go away. It just moves down a level.

I checked this on a throwaway SQLite copy of your models and template, with 50 open orders and 3 items each. I didn't touch your project.

| queryset | queries |
|---|---|
| current | 251 |
| your plan | 152 |
| `+ prefetch_related('items__product')` | 3 |
| `+ Prefetch('items', queryset=OrderItem.objects.select_related('product'))` | 2 |

All four rendered the same HTML. With your plan, the query count still grows with the number of line items. With either fix it stays at 3 (or 2), no matter how many orders or items there are.

**The fix**

```python
orders = (
    Order.objects.filter(status="open")
    .select_related("customer")
    .prefetch_related("items__product")
    .order_by("-created_at")[:50]
)
```

Prefetching `items__product` fetches `items` on the way, so you don't need to list `items` separately. The `Prefetch(..., queryset=OrderItem.objects.select_related("product"))` version saves one more query because it JOINs products into the items query. Either one is fine. The first is easier to read.

**A checklist for doing these yourself**

1. **Start from the template, not the view.** List every dotted lookup inside a loop. Here that's `order.customer.name`, `order.items.all` and `item.product.name`.
2. **Mark each step that crosses into another model.** Plain fields like `order.id` or `item.quantity` cost nothing.
3. **Check which direction each relation points:**
   - many→one (ForeignKey or OneToOne, followed forward): use `select_related`
   - one→many or many↔many (reverse FK, ManyToMany): use `prefetch_related`
4. **Repeat inside nested loops.** This is the step that got skipped here. Whatever you prefetch becomes a new loop variable (`item`), and its lookups need the same check. Chain the names with `__`, as in `items__product`.
5. **Count the queries** before and after, using django-debug-toolbar or a test:

   ```python
   def test_order_list_query_count(self):
       # create a few orders with several items each first
       with self.assertNumQueries(3):  # plus any session/auth queries your middleware adds
           self.client.get("/orders/")  # use your real URL
   ```

   A test like this also catches it if someone brings the N+1 back later.

One more trap: the prefetched items are only used when you call `.all`. If the template or a model method ever calls `order.items.filter(...)` or `order.items.order_by(...)`, Django ignores the prefetched rows and queries again for every order. If you need filtering or ordering, put it in the queryset of a `Prefetch(...)` object.

Do you want to make the change yourself? I can add the `assertNumQueries` test for you, or check your diff when you're done.
