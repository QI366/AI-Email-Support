"""
Helios store policy + a deterministic evaluator.

The evaluator does the arithmetic (days elapsed, windows remaining, what the
customer is entitled to) in Python instead of asking the model to do it. The
model receives the *result* as facts it must not contradict. This is the main
guard against a friendly-sounding email inventing a refund the policy doesn't
allow, or getting date maths wrong.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

RETURN_WINDOW_DAYS = 30
DAMAGE_REPORT_WINDOW_DAYS = 2
WARRANTY_MONTHS = 12
WARRANTY_DAYS = 365
RESTOCKING_FEE_PCT = 15
REFUND_SLA_DAYS = 5  # business days after the warehouse receives a return
REFUND_SLA_CALENDAR_DAYS = 7
LOST_PACKAGE_CLAIM_DAYS = 7  # days past the estimated delivery date
CANCEL_WINDOW_HOURS = 2

ORDER_POLICY = f"""HELIOS ORDER POLICY (v3.1)

1. Pricing and stock
   - The price shown at checkout is the price charged. Promotional prices are
     not held or backdated after an order is placed.
   - "low_stock" means fewer than 10 units are in the fulfilment centre. Stock
     is not reserved until payment is captured.
   - Helios never promises a unit will still be available later.

2. Processing and shipping
   - Orders placed before 14:00 local warehouse time ship the same business day,
     otherwise the next business day.
   - Standard delivery is 3-5 business days, expedited 1-2 business days.
   - Estimated delivery dates are carrier estimates, not guarantees.

3. Changes and cancellation
   - An order can be cancelled or have its address changed free of charge within
     {CANCEL_WINDOW_HOURS} hours of purchase, and any time while it is still
     "paid_unshipped" (before it reaches "in_transit").
   - Once the carrier has scanned the parcel, Helios cannot recall or redirect it.
     The customer may refuse delivery or return it under the return policy.

4. Delays and lost parcels
   - If tracking has not updated for 5 or more days, Helios opens a carrier trace
     on the customer's behalf. A trace takes up to 3 business days.
   - A parcel is treated as lost {LOST_PACKAGE_CLAIM_DAYS} days after the estimated
     delivery date with no delivery scan. Helios then offers, at the customer's
     choice, a free replacement shipped expedited, or a full refund. The customer
     is never asked to wait for the carrier to pay out first.

5. Helios Plus members
   - Free expedited reshipment on delayed or lost parcels.
   - Return shipping is free on every return, including change of mind.
   - Refunds are released as soon as the return is scanned by the carrier.
"""

RETURN_POLICY = f"""HELIOS RETURN, REFUND AND WARRANTY POLICY (v3.1)

1. Change-of-mind returns
   - {RETURN_WINDOW_DAYS} days from the delivery date.
   - Unopened items: full refund.
   - Opened but undamaged items: refund minus a {RESTOCKING_FEE_PCT}% restocking
     fee. The fee is waived for Helios Plus members.
   - Return shipping is paid by the customer (free for Helios Plus).
   - After day {RETURN_WINDOW_DAYS} a change-of-mind return is not accepted. Support
     may offer, as a goodwill gesture and at most once per customer per year, a
     store credit of up to 20% of the item price. Never present this as a refund.

2. Damaged on arrival
   - Must be reported within {DAMAGE_REPORT_WINDOW_DAYS} days of delivery, with
     photos of the item and of the outer packaging.
   - Helios ships a free replacement immediately once photos are received; the
     customer is not asked to return the damaged unit first.
   - A prepaid return label is emailed for the damaged unit. If it is not sent
     back within 30 days the replacement is charged.
   - Return shipping is always free in this case.

3. Wrong item shipped
   - Helios error. Free prepaid return label, correct item shipped expedited at
     no cost, no restocking fee, no return-first requirement.
   - Reportable up to {RETURN_WINDOW_DAYS} days after delivery.

4. Defective items and warranty
   - Defective within {RETURN_WINDOW_DAYS} days of delivery: free replacement or
     full refund, customer's choice, free return shipping.
   - After {RETURN_WINDOW_DAYS} days and within {WARRANTY_MONTHS} months of
     delivery: warranty replacement of the item or the failing part, free of
     charge. Refunds are not offered under warranty unless a replacement is
     unavailable.
   - Warranty covers manufacturing and battery-degradation faults. It does not
     cover accidental damage, liquid damage, or normal cosmetic wear.
   - Support may request a short troubleshooting step and the serial number
     before raising a warranty case. A warranty case is resolved within
     2 business days of the customer replying.

5. Refund timing
   - Refunds are issued to the original payment method.
   - Helios releases the refund within {REFUND_SLA_DAYS} business days of the
     warehouse receiving the return; the bank then takes 3-5 business days to post it.
   - If more than {REFUND_SLA_CALENDAR_DAYS} calendar days have passed since the
     warehouse received the return and no refund has been released, support must
     escalate to the payments team and give a firm resolution date within
     2 business days. No further waiting is asked of the customer.

6. Non-returnable
   - Consumable filters, opened hygiene items, and digital gift cards.

7. What support must never do
   - Never invent an order number, tracking number, refund date, or serial number.
   - Never promise a delivery date the carrier has not confirmed.
   - Never quote a policy outcome more generous than the rules above without
     labelling it clearly as a one-off goodwill exception.
"""


def _d(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def _days_since(value: str | None, today: date) -> int | None:
    d = _d(value)
    return None if d is None else (today - d).days


def evaluate(context: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    """Return the policy facts the model is allowed to rely on."""
    today = today or date.today()
    order = context.get("order") or {}
    product = context.get("product") or {}
    customer = context.get("customer") or {}
    plus = customer.get("tier") == "helios_plus"

    status = order.get("order_status")
    condition = order.get("condition_reported")

    days_since_delivery = _days_since(order.get("delivered_date"), today)
    days_past_eta = _days_since(order.get("estimated_delivery"), today)
    days_since_scan = _days_since(order.get("last_tracking_scan"), today)
    days_since_return_received = _days_since(order.get("return_received"), today)

    facts: dict[str, Any] = {
        "today": today.isoformat(),
        "customer_tier": "Helios Plus member" if plus else "standard customer",
        "order_state": status,
        "reported_condition": condition,
    }

    # --- return window -----------------------------------------------------
    if days_since_delivery is not None:
        left = RETURN_WINDOW_DAYS - days_since_delivery
        facts["days_since_delivery"] = days_since_delivery
        facts["return_window_days_remaining"] = max(left, 0)
        facts["inside_return_window"] = left > 0
        facts["days_since_delivery_note"] = (
            f"delivered {days_since_delivery} days ago"
            + (f", {left} days left in the {RETURN_WINDOW_DAYS}-day window" if left > 0
               else f", the {RETURN_WINDOW_DAYS}-day change-of-mind window closed {abs(left)} days ago")
        )

    # --- warranty ----------------------------------------------------------
    if days_since_delivery is not None:
        facts["warranty_active"] = days_since_delivery <= WARRANTY_DAYS
        facts["warranty_days_remaining"] = max(WARRANTY_DAYS - days_since_delivery, 0)

    # --- damage window -----------------------------------------------------
    if condition == "damaged_in_transit" and days_since_delivery is not None:
        inside = days_since_delivery <= DAMAGE_REPORT_WINDOW_DAYS
        facts["damage_report_window_met"] = inside
        facts["entitlement"] = (
            "free replacement shipped immediately, prepaid return label for the damaged unit, "
            "no return-first requirement, free return shipping"
            if inside else
            "damage reported outside the 2-day window; handle as a standard return or warranty case"
        )
        facts["required_from_customer"] = "photos of the item and of the outer packaging"

    # --- wrong item --------------------------------------------------------
    elif condition == "wrong_item_received":
        facts["entitlement"] = (
            "Helios fulfilment error: correct item shipped expedited at no cost, free prepaid "
            "return label for the wrong item, no restocking fee, customer pays nothing"
        )
        facts["received_instead"] = order.get("item_received")

    # --- change of mind ----------------------------------------------------
    elif condition == "opened_no_defect":
        inside = bool(facts.get("inside_return_window"))
        if inside:
            fee = 0 if plus else round(float(order.get("amount_paid") or 0) * RESTOCKING_FEE_PCT / 100, 2)
            facts["entitlement"] = (
                f"refund of {order.get('amount_paid')} minus a {RESTOCKING_FEE_PCT}% restocking fee "
                f"({fee} {product.get('currency', 'USD')})" if fee else
                "full refund, restocking fee waived for Helios Plus"
            )
            facts["return_shipping"] = "free (Helios Plus)" if plus else "paid by the customer"
        else:
            facts["entitlement"] = (
                "not eligible for a change-of-mind refund. Maximum available: a one-off goodwill "
                f"store credit of up to 20% of {product.get('price')} "
                f"({round(float(product.get('price') or 0) * 0.2, 2)} {product.get('currency', 'USD')}), "
                "which must be described as store credit, not a refund"
            )
            facts["may_not_offer"] = "refund to the original payment method"

    # --- warranty defect ---------------------------------------------------
    elif condition == "battery_failure":
        if facts.get("inside_return_window"):
            facts["entitlement"] = "free replacement or full refund, customer's choice"
        elif facts.get("warranty_active"):
            facts["entitlement"] = (
                f"warranty replacement of the unit or the failing part, free of charge "
                f"({facts.get('warranty_days_remaining')} days of the {WARRANTY_MONTHS}-month warranty remain). "
                "A refund is not available under warranty."
            )
            facts["required_from_customer"] = (
                "serial number printed on the unit, plus confirmation that it was charged on its original "
                "charger and still fails"
            )
            facts["resolution_sla"] = "warranty case resolved within 2 business days of the customer replying"
        else:
            facts["entitlement"] = "outside both the return window and the 12-month warranty"

    # --- shipping delay ----------------------------------------------------
    if status == "in_transit":
        facts["days_past_estimated_delivery"] = days_past_eta
        facts["days_since_last_tracking_scan"] = days_since_scan
        facts["last_tracking_event"] = order.get("last_tracking_event")
        trace = days_since_scan is not None and days_since_scan >= 5
        lost = days_past_eta is not None and days_past_eta >= LOST_PACKAGE_CLAIM_DAYS
        facts["carrier_trace_required"] = trace
        facts["treated_as_lost"] = lost
        if lost:
            facts["entitlement"] = "free expedited replacement or a full refund, customer's choice, immediately"
        elif trace:
            facts["entitlement"] = (
                f"carrier trace opened on the customer's behalf, result within 3 business days; "
                f"parcel is treated as lost on day {LOST_PACKAGE_CLAIM_DAYS} past the estimate "
                f"(that is {LOST_PACKAGE_CLAIM_DAYS - (days_past_eta or 0)} days from today), and the "
                "customer then chooses a free expedited replacement or a full refund"
            )
        if plus:
            facts["tier_benefit"] = "Helios Plus: replacement ships expedited at no cost"
        facts["may_not_offer"] = "a confirmed new delivery date; the carrier has not provided one"

    # --- refund in flight --------------------------------------------------
    if order.get("payment_status") == "refund_processing":
        facts["days_since_warehouse_received_return"] = days_since_return_received
        facts["refund_amount"] = order.get("refund_amount")
        facts["refund_method"] = order.get("refund_method")
        breached = days_since_return_received is not None and days_since_return_received > REFUND_SLA_CALENDAR_DAYS
        facts["refund_sla_breached"] = breached
        if breached:
            facts["entitlement"] = (
                f"SLA breached ({days_since_return_received} days vs the {REFUND_SLA_CALENDAR_DAYS}-day limit). "
                "Escalate to the payments team, commit to a firm resolution date within 2 business days, "
                "and do not ask the customer to keep waiting."
            )
        else:
            facts["entitlement"] = (
                f"refund is within the {REFUND_SLA_DAYS}-business-day release window; the bank then "
                "takes a further 3-5 business days to post it"
            )

    # --- pre-purchase ------------------------------------------------------
    if status == "pre_order_inquiry":
        facts["entitlement"] = "no order exists yet; nothing to look up, cancel or refund"
        facts["stock_note"] = (
            f"stock_status is {product.get('stock_status')}: fewer than 10 units in the fulfilment centre, "
            "and stock is not reserved until payment is captured"
        )
        facts["price_note"] = (
            f"current price {product.get('price')} {product.get('currency')}, "
            f"list price {product.get('original_price')}; the checkout price is what is charged and "
            "promotional pricing is not held or backdated"
        )
        facts["if_they_buy"] = (
            f"{RETURN_WINDOW_DAYS}-day return window from delivery; unopened is a full refund, "
            f"opened but undamaged is a refund minus a {RESTOCKING_FEE_PCT}% restocking fee; "
            "defective on arrival is free replacement or full refund with free return shipping"
        )

    # --- other order-flow states ------------------------------------------
    if status == "paid_unshipped":
        facts["entitlement"] = (
            "order is paid but not yet shipped: address change, upgrade to expedited shipping, "
            "or cancellation for a full refund are all available while it stays unshipped"
        )
    elif status == "arrived_unsigned":
        facts["entitlement"] = (
            "parcel has arrived at a pickup point/locker or a delivery attempt was missed: guide the "
            "customer to collect it or arrange a redelivery. The delivery address can no longer be changed"
        )
    elif status == "received_unconfirmed":
        facts["entitlement"] = (
            "package appears received but is not yet confirmed as signed: invite the customer to confirm "
            "receipt in the app; if something is wrong with the item, route to the returns/after-sales flow"
        )
    elif status == "returning" and order.get("payment_status") != "refund_processing":
        facts["entitlement"] = (
            "a return is in progress: give the return-reason status and the prepaid label, and state that "
            "the refund is released once the warehouse scans the returned item"
        )
    elif status == "return_completed":
        facts["entitlement"] = (
            "the return is complete and the refund has been settled: confirm the refund, that the order is "
            "archived, and that the item can be purchased again if the customer wants it"
        )

    return facts
