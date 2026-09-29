"""invoice-mailer: emails each invoice PDF to the customer.

Runs as 3 replicas on Kubernetes; redeployed several times a week.
"""
import json

from kafka import KafkaConsumer  # kafka-python 2.0.2

from billing import send_invoice_email  # ~200ms per call (SMTP)

consumer = KafkaConsumer(
    "invoices",
    bootstrap_servers=["kafka:9092"],
    group_id="invoice-mailer",
    enable_auto_commit=True,
    auto_commit_interval_ms=5000,
    max_poll_records=500,
    value_deserializer=lambda v: json.loads(v),
)

for msg in consumer:
    invoice = msg.value
    send_invoice_email(invoice["customer_email"], invoice["pdf_url"])
