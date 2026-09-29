from django.shortcuts import render

from .models import Order


def order_list(request):
    orders = Order.objects.filter(status="open").order_by("-created_at")[:50]
    return render(request, "orders/list.html", {"orders": orders})
