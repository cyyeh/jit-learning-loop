"""invoice-mailer: emails each invoice PDF to the customer.

Runs as 3 replicas on Kubernetes; redeployed several times a week.

Delivery guarantee: at-least-once.
- An offset is committed only after its email has been sent, one message at a
  time, so a restart resumes right after the last email that actually went out.
- On SIGTERM (what Kubernetes sends at every deploy) we finish the email in
  flight, commit it, and leave the consumer group cleanly.
A duplicate is still possible if the process dies hard (SIGKILL, OOM, node
crash) between sending an email and committing its offset. Removing that last
case needs an idempotency check on the invoice id before sending.
"""
import json
import logging
import signal

from kafka import KafkaConsumer, OffsetAndMetadata  # kafka-python 2.0.2

from billing import send_invoice_email  # ~200ms per call (SMTP)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("invoice-mailer")

consumer = KafkaConsumer(
    "invoices",
    bootstrap_servers=["kafka:9092"],
    group_id="invoice-mailer",
    # We commit ourselves, right after each email. Auto-commit only writes the
    # offset inside poll(), i.e. once per batch, so everything sent since the
    # previous poll() was re-sent after a restart.
    enable_auto_commit=False,
    # 20 x ~200ms = ~4s of work per poll(), instead of 500 x 200ms = ~100s.
    # Keeps rebalances quick and stays far below max_poll_interval_ms (300s).
    max_poll_records=20,
    value_deserializer=lambda v: json.loads(v),
)

shutting_down = False


def request_shutdown(signum, frame):
    # Only set a flag: never abort an email halfway through.
    global shutting_down
    shutting_down = True
    log.info("received signal %s; finishing the current email, then exiting", signum)


signal.signal(signal.SIGTERM, request_shutdown)  # Kubernetes, on deploy
signal.signal(signal.SIGINT, request_shutdown)   # Ctrl-C, locally


def process(batch):
    for tp, records in batch.items():
        for msg in records:
            if shutting_down:
                return
            invoice = msg.value
            send_invoice_email(invoice["customer_email"], invoice["pdf_url"])
            # The committed offset is "the next message to read", hence +1.
            # Pass it explicitly: consumer.commit() with no arguments would
            # commit the whole poll() batch, including emails not yet sent.
            consumer.commit({tp: OffsetAndMetadata(msg.offset + 1, "")})


try:
    while not shutting_down:
        process(consumer.poll(timeout_ms=1000))
finally:
    # Sends LeaveGroup so the partitions move to another replica right away,
    # instead of after session_timeout_ms. Auto-commit is off, so close()
    # does not commit anything we have not sent.
    consumer.close()
