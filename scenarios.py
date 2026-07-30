"""
Fake order-context scenarios.

Every scenario carries a `product` block and an `order` block that mirror the
shape of the reference payload. Dates are stored as *relative day offsets* and
materialised at request time, so the policy engine always sees fresh numbers
(a "delivered 41 days ago" order stays 41 days old next month).

offset semantics: -3 means "3 days ago", +2 means "in 2 days", None means null.
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any

SUPPORT_BRAND = "Helios"


def _iso(offset: int | None, today: date) -> str | None:
    if offset is None:
        return None
    return (today + timedelta(days=offset)).isoformat()


SCENARIOS: list[dict[str, Any]] = [
    {
        "scenario_id": "pre_order_inquiry",
        "title": "Pre-order question",
        "blurb": "No order yet. The shopper is comparing power banks and wants to know if it can charge a laptop before stock runs out.",
        "image": "/static/img/anker737.svg",
        "customer": {"name": "Alex Rivera", "email": "alex.rivera@example.com", "tier": "standard"},
        "suggested_subject": "Will this charge a 16\" MacBook Pro?",
        "suggested_body": (
            "Hi,\n\n"
            "I'm about to buy the Anker 737 but the listing says only 3 left. Two questions before I order:\n"
            "1. Can it actually fast-charge a 16-inch MacBook Pro, or only phones?\n"
            "2. If I order today, will the $89.99 price still apply, and can I return it if it doesn't work with my laptop?\n\n"
            "Thanks,\nAlex"
        ),
        "product": {
            "product_id": "B09JQK7YXT",
            "product_name": "Anker 737 Power Bank (PowerCore 24K)",
            "category": "Electronics",
            "sub_category": "Portable Chargers",
            "brand": "Anker",
            "price": 89.99,
            "original_price": 109.99,
            "currency": "USD",
            "sales_volume": 4300,
            "rating": 4.7,
            "review_count": 6821,
            "stock_status": "low_stock",
            "description": "24,000mAh power bank with 140W output, smart digital display, and fast charging for laptops.",
            "key_features": [
                "140W max output via USB-C",
                "Digital display shows charge percentage",
                "Recharges to 100% in about 1 hour",
                "Compatible with laptops, phones, and tablets",
            ],
            "image_url": "/static/img/anker737.svg",
        },
        "order_template": {
            "order_id": None,
            "product_id": "B09JQK7YXT",
            "order_status": "pre_order_inquiry",
            "order_date_offset": None,
            "payment_status": "not_ordered",
            "shipping_carrier": None,
            "tracking_number": None,
            "estimated_delivery_offset": None,
            "delivered_date_offset": None,
            "shipping_address": None,
            "quantity": None,
            "amount_paid": None,
        },
    },
    {
        "scenario_id": "shipment_delayed",
        "title": "Shipment stuck in transit",
        "blurb": "Paid and shipped, but the tracking has not scanned in 6 days and the delivery estimate has passed.",
        "image": "/static/img/sony-xm5.svg",
        "customer": {"name": "Priya Nair", "email": "priya.nair@example.com", "tier": "helios_plus"},
        "suggested_subject": "Order HS-24817 hasn't moved in six days",
        "suggested_body": (
            "Hello,\n\n"
            "My headphones were supposed to arrive on the 12th. The tracking page still says "
            "\"Departed facility\" from six days ago and nothing since. I need these for a work trip on Friday.\n\n"
            "Can you tell me where the package actually is, and what happens if it's lost?\n\n"
            "Priya"
        ),
        "product": {
            "product_id": "B09XS7JWHH",
            "product_name": "Sony WH-1000XM5 Wireless Headphones",
            "category": "Electronics",
            "sub_category": "Headphones",
            "brand": "Sony",
            "price": 348.00,
            "original_price": 399.99,
            "currency": "USD",
            "sales_volume": 12800,
            "rating": 4.6,
            "review_count": 21455,
            "stock_status": "in_stock",
            "description": "Industry-leading noise cancelling over-ear headphones with 30-hour battery life.",
            "key_features": [
                "8-mic adaptive noise cancelling",
                "30-hour battery, 3-minute quick charge",
                "Multipoint pairing for two devices",
                "Speak-to-chat auto pause",
            ],
            "image_url": "/static/img/sony-xm5.svg",
        },
        "order_template": {
            "order_id": "HS-24817",
            "product_id": "B09XS7JWHH",
            "order_status": "in_transit",
            "order_date_offset": -11,
            "payment_status": "paid",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10123456784",
            "estimated_delivery_offset": -4,
            "delivered_date_offset": None,
            "last_tracking_scan_offset": -6,
            "last_tracking_event": "Departed facility - Louisville, KY",
            "shipping_address": "412 Sunset Blvd, Apt 9, Los Angeles, CA 90026, US",
            "quantity": 1,
            "amount_paid": 348.00,
        },
    },
    {
        "scenario_id": "damaged_on_arrival",
        "title": "Arrived damaged",
        "blurb": "Delivered 2 days ago with a cracked housing. Inside the 48-hour damage-report window.",
        "image": "/static/img/ninja-airfryer.svg",
        "customer": {"name": "Marcus Webb", "email": "m.webb@example.com", "tier": "standard"},
        "suggested_subject": "Air fryer arrived cracked - order HS-24102",
        "suggested_body": (
            "Hi there,\n\n"
            "The air fryer showed up on Tuesday and the basket housing is cracked along the bottom seam. "
            "The outer box was crushed on one corner, so I think it happened in transit.\n\n"
            "I don't want a repair, I'd like a replacement. Do I need to ship this one back first? "
            "I still have the original box.\n\n"
            "Marcus"
        ),
        "product": {
            "product_id": "B07S4YMQZ2",
            "product_name": "Ninja AF161 Max XL Air Fryer 5.5 Qt",
            "category": "Home & Kitchen",
            "sub_category": "Air Fryers",
            "brand": "Ninja",
            "price": 129.99,
            "original_price": 159.99,
            "currency": "USD",
            "sales_volume": 9600,
            "rating": 4.8,
            "review_count": 33210,
            "stock_status": "in_stock",
            "description": "5.5-quart air fryer with Max Crisp technology, 7 cooking programs, and dishwasher-safe basket.",
            "key_features": [
                "5.5 qt ceramic-coated basket",
                "Max Crisp at 450F",
                "7 programs including dehydrate",
                "Dishwasher-safe parts",
            ],
            "image_url": "/static/img/ninja-airfryer.svg",
        },
        "order_template": {
            "order_id": "HS-24102",
            "product_id": "B07S4YMQZ2",
            "order_status": "delivered",
            "order_date_offset": -8,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "782934115067",
            "estimated_delivery_offset": -2,
            "delivered_date_offset": -2,
            "shipping_address": "77 Maple Street, Portland, OR 97205, US",
            "quantity": 1,
            "amount_paid": 129.99,
            "condition_reported": "damaged_in_transit",
        },
    },
    {
        "scenario_id": "wrong_item_shipped",
        "title": "Wrong item shipped",
        "blurb": "Ordered the wireless MX Master 3S, received a wired budget mouse. Fulfilment error on our side.",
        "image": "/static/img/mx-master.svg",
        "customer": {"name": "Daniela Ortiz", "email": "d.ortiz@example.com", "tier": "standard"},
        "suggested_subject": "Recibí el producto equivocado - pedido HS-23988",
        "suggested_body": (
            "Buenas tardes,\n\n"
            "Pedí un Logitech MX Master 3S en color grafito, pero en la caja venía un ratón con cable de otra marca. "
            "El número de pedido es HS-23988.\n\n"
            "Necesito el ratón correcto lo antes posible para trabajar. ¿Tengo que pagar el envío de devolución?\n\n"
            "Gracias,\nDaniela"
        ),
        "product": {
            "product_id": "B09HM94VDS",
            "product_name": "Logitech MX Master 3S Wireless Mouse (Graphite)",
            "category": "Electronics",
            "sub_category": "Computer Mice",
            "brand": "Logitech",
            "price": 99.99,
            "original_price": 119.99,
            "currency": "USD",
            "sales_volume": 15400,
            "rating": 4.7,
            "review_count": 18902,
            "stock_status": "in_stock",
            "description": "8K DPI quiet-click wireless mouse with MagSpeed scrolling and multi-device Flow support.",
            "key_features": [
                "8,000 DPI on any surface including glass",
                "Quiet Click buttons",
                "MagSpeed electromagnetic scroll wheel",
                "Works across 3 devices with Logi Flow",
            ],
            "image_url": "/static/img/mx-master.svg",
        },
        "order_template": {
            "order_id": "HS-23988",
            "product_id": "B09HM94VDS",
            "order_status": "delivered",
            "order_date_offset": -9,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223197428490",
            "estimated_delivery_offset": -3,
            "delivered_date_offset": -3,
            "shipping_address": "Calle Mayor 18, 3B, 28013 Madrid, ES",
            "quantity": 1,
            "amount_paid": 99.99,
            "condition_reported": "wrong_item_received",
            "item_received": "Generic wired optical mouse (SKU MISC-WM102)",
        },
    },
    {
        "scenario_id": "return_window_expired",
        "title": "Return window has closed",
        "blurb": "Delivered 41 days ago, opened and used, no defect. Outside the 30-day change-of-mind window.",
        "image": "/static/img/levoit-purifier.svg",
        "customer": {"name": "Tom Halvorsen", "email": "tom.h@example.com", "tier": "standard"},
        "suggested_subject": "Want to return the air purifier",
        "suggested_body": (
            "Hi,\n\n"
            "I bought this air purifier about six weeks ago and honestly it's just too loud for my bedroom. "
            "Nothing is broken, I simply don't use it. I'd like to send it back for a refund.\n\n"
            "Order HS-23440. The box is opened but I kept everything.\n\n"
            "Tom"
        ),
        "product": {
            "product_id": "B07VVK39F7",
            "product_name": "Levoit Core 300 Air Purifier",
            "category": "Home & Kitchen",
            "sub_category": "Air Purifiers",
            "brand": "Levoit",
            "price": 99.99,
            "original_price": 99.99,
            "currency": "USD",
            "sales_volume": 22100,
            "rating": 4.7,
            "review_count": 84120,
            "stock_status": "in_stock",
            "description": "Compact HEPA air purifier rated for rooms up to 219 sq ft with a 24dB sleep mode.",
            "key_features": [
                "3-stage H13 True HEPA filtration",
                "24dB sleep mode",
                "Covers 219 sq ft",
                "Filter change indicator",
            ],
            "image_url": "/static/img/levoit-purifier.svg",
        },
        "order_template": {
            "order_id": "HS-23440",
            "product_id": "B07VVK39F7",
            "order_status": "delivered",
            "order_date_offset": -46,
            "payment_status": "paid",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10987654321",
            "estimated_delivery_offset": -41,
            "delivered_date_offset": -41,
            "shipping_address": "1200 Lake Shore Dr, Chicago, IL 60610, US",
            "quantity": 1,
            "amount_paid": 99.99,
            "condition_reported": "opened_no_defect",
        },
    },
    {
        "scenario_id": "refund_pending",
        "title": "Refund not received",
        "blurb": "Return was delivered back to the warehouse 9 days ago and the refund still shows as processing.",
        "image": "/static/img/instant-pot.svg",
        "customer": {"name": "Sofía Márquez", "email": "sofia.marquez@example.com", "tier": "helios_plus"},
        "suggested_subject": "¿Dónde está mi reembolso? Pedido HS-22755",
        "suggested_body": (
            "Hola,\n\n"
            "Devolví la olla el día 3 y el almacén la recibió hace más de una semana, pero en mi cuenta "
            "sigue apareciendo \"reembolso en proceso\" y no veo nada en mi tarjeta.\n\n"
            "Ya son 148 dólares retenidos. ¿Cuándo voy a recibir el dinero?\n\n"
            "Sofía"
        ),
        "product": {
            "product_id": "B08PQ2KWHS",
            "product_name": "Instant Pot Duo Plus 6 Qt Pressure Cooker",
            "category": "Home & Kitchen",
            "sub_category": "Pressure Cookers",
            "brand": "Instant Pot",
            "price": 148.00,
            "original_price": 169.99,
            "currency": "USD",
            "sales_volume": 18700,
            "rating": 4.6,
            "review_count": 45900,
            "stock_status": "in_stock",
            "description": "9-in-1 electric pressure cooker with sous vide, whisper-quiet steam release and 15 programs.",
            "key_features": [
                "9 appliances in one",
                "Whisper-quiet steam release",
                "15 one-touch programs",
                "Stainless steel inner pot",
            ],
            "image_url": "/static/img/instant-pot.svg",
        },
        "order_template": {
            "order_id": "HS-22755",
            "product_id": "B08PQ2KWHS",
            "order_status": "returning",
            "order_date_offset": -38,
            "payment_status": "refund_processing",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10555512345",
            "estimated_delivery_offset": -31,
            "delivered_date_offset": -31,
            "return_received_offset": -9,
            "refund_amount": 148.00,
            "refund_method": "Visa ending 4417",
            "shipping_address": "Av. Diagonal 402, 08037 Barcelona, ES",
            "quantity": 1,
            "amount_paid": 148.00,
        },
    },
    {
        "scenario_id": "warranty_claim",
        "title": "Fails after 5 months",
        "blurb": "Out of the return window but inside the 12-month warranty. Battery no longer holds a charge.",
        "image": "/static/img/eufy-vacuum.svg",
        "customer": {"name": "Grace Okafor", "email": "grace.okafor@example.com", "tier": "standard"},
        "suggested_subject": "Robot vacuum battery died after 5 months",
        "suggested_body": (
            "Hello,\n\n"
            "I bought this vacuum in the spring and it worked fine until last week. Now it runs for about "
            "six minutes and shuts off, even after a full charge overnight. I've already reset it and cleaned the contacts.\n\n"
            "It's out of the return window, but surely five months is too early for this? Order HS-21063.\n\n"
            "Grace"
        ),
        "product": {
            "product_id": "B07QXM2V9K",
            "product_name": "eufy RoboVac 11S Max Robot Vacuum",
            "category": "Home & Kitchen",
            "sub_category": "Robot Vacuums",
            "brand": "eufy",
            "price": 199.99,
            "original_price": 249.99,
            "currency": "USD",
            "sales_volume": 7400,
            "rating": 4.5,
            "review_count": 29800,
            "stock_status": "in_stock",
            "description": "Slim 2000Pa robot vacuum with BoostIQ, 100-minute runtime and quiet operation.",
            "key_features": [
                "2000Pa suction with BoostIQ",
                "2.85in slim body",
                "100-minute runtime",
                "Anti-scratch tempered glass top",
            ],
            "image_url": "/static/img/eufy-vacuum.svg",
        },
        "order_template": {
            "order_id": "HS-21063",
            "product_id": "B07QXM2V9K",
            "order_status": "delivered",
            "order_date_offset": -158,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "770114528899",
            "estimated_delivery_offset": -152,
            "delivered_date_offset": -152,
            "shipping_address": "9 Belmont Rd, Austin, TX 78704, US",
            "quantity": 1,
            "amount_paid": 199.99,
            "condition_reported": "battery_failure",
        },
    },
    {
        "scenario_id": "address_change_unshipped",
        "title": "Change address before it ships",
        "blurb": "Paid an hour ago and just realised the order is going to the old apartment. Wants the address fixed before it leaves the warehouse.",
        "image": "/static/img/keychron-k8.svg",
        "customer": {"name": "Jordan Lee", "email": "jordan.lee@example.com", "tier": "standard"},
        "suggested_subject": "Need to update the delivery address on HS-25190",
        "suggested_body": (
            "Hi,\n\n"
            "I placed order HS-25190 about an hour ago and it hasn't shipped yet. I just noticed the "
            "address autofilled to my old apartment. Can you change it to:\n\n"
            "88 Cedar Lane, Apt 4C, Seattle, WA 98109, US\n\n"
            "Also, is it too late to switch to expedited shipping? Happy to pay the difference.\n\n"
            "Thanks,\nJordan"
        ),
        "product": {
            "product_id": "B09NP9X4M8",
            "product_name": "Keychron K8 Wireless Mechanical Keyboard",
            "category": "Electronics",
            "sub_category": "Keyboards",
            "brand": "Keychron",
            "price": 89.00,
            "original_price": 99.00,
            "currency": "USD",
            "sales_volume": 8100,
            "rating": 4.7,
            "review_count": 12440,
            "stock_status": "in_stock",
            "description": "Tenkeyless hot-swappable mechanical keyboard with Bluetooth, wired USB-C, and Mac/Windows layouts.",
            "key_features": [
                "Hot-swappable switches",
                "Bluetooth 5.1 and wired USB-C",
                "Mac and Windows keycaps included",
                "Up to 240 hours of battery life",
            ],
            "image_url": "/static/img/keychron-k8.svg",
        },
        "order_template": {
            "order_id": "HS-25190",
            "product_id": "B09NP9X4M8",
            "order_status": "paid_unshipped",
            "order_date_offset": 0,
            "payment_status": "paid",
            "shipping_carrier": None,
            "tracking_number": None,
            "estimated_delivery_offset": 4,
            "delivered_date_offset": None,
            "shipping_address": "215 Birch Ave, Apt 2, Seattle, WA 98103, US",
            "quantity": 1,
            "amount_paid": 89.00,
        },
    },
    {
        "scenario_id": "arrived_awaiting_pickup",
        "title": "Waiting at the parcel locker",
        "blurb": "Tracking says the parcel reached a pickup locker two days ago, but no access code ever arrived and the app still shows it undelivered.",
        "image": "/static/img/kindle-paperwhite.svg",
        "customer": {"name": "Hannah Bishop", "email": "hannah.bishop@example.com", "tier": "standard"},
        "suggested_subject": "No pickup code for order HS-24990",
        "suggested_body": (
            "Hello,\n\n"
            "The tracking for HS-24990 says my Kindle was delivered to a parcel locker on Monday, but I "
            "never received a code or email to open the locker. The app still shows the order as not "
            "delivered.\n\n"
            "How do I actually collect it, or can it be redelivered to my door instead?\n\n"
            "Hannah"
        ),
        "product": {
            "product_id": "B08KTZ8249",
            "product_name": "Kindle Paperwhite (16 GB, 6.8\" display)",
            "category": "Electronics",
            "sub_category": "E-readers",
            "brand": "Amazon",
            "price": 149.99,
            "original_price": 159.99,
            "currency": "USD",
            "sales_volume": 26500,
            "rating": 4.7,
            "review_count": 51230,
            "stock_status": "in_stock",
            "description": "6.8-inch glare-free e-reader with adjustable warm light, waterproofing, and weeks of battery life.",
            "key_features": [
                "6.8\" 300 ppi glare-free display",
                "Adjustable warm light",
                "IPX8 waterproof",
                "Weeks of battery on a charge",
            ],
            "image_url": "/static/img/kindle-paperwhite.svg",
        },
        "order_template": {
            "order_id": "HS-24990",
            "product_id": "B08KTZ8249",
            "order_status": "arrived_unsigned",
            "order_date_offset": -5,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "612093847755",
            "estimated_delivery_offset": -2,
            "delivered_date_offset": None,
            "last_tracking_scan_offset": -2,
            "last_tracking_event": "Arrived at pickup locker - Ballard Station, Seattle, WA",
            "shipping_address": "215 Birch Ave, Apt 2, Seattle, WA 98103, US",
            "quantity": 1,
            "amount_paid": 149.99,
        },
    },
    {
        "scenario_id": "received_not_confirmed",
        "title": "Delivered but not marked received",
        "blurb": "Contactless drop at the door three days ago. The customer has the bottle, but the app still shows it in transit and won't let them confirm receipt.",
        "image": "/static/img/owala-freesip.svg",
        "customer": {"name": "Diego Fuentes", "email": "diego.fuentes@example.com", "tier": "standard"},
        "suggested_subject": "Order HS-24905 - ya lo recibí pero aparece en tránsito",
        "suggested_body": (
            "Hola,\n\n"
            "El repartidor dejó el paquete en mi puerta el sábado y ya tengo la botella en la mano, pero "
            "en la aplicación el pedido HS-24905 sigue apareciendo \"en tránsito\" y no me deja pulsar "
            "\"confirmar recepción\".\n\n"
            "¿Cómo confirmo que ya llegó? Quiero asegurarme de que no se marque como perdido.\n\n"
            "Gracias,\nDiego"
        ),
        "product": {
            "product_id": "B09XKF3T2L",
            "product_name": "Owala FreeSip Insulated Water Bottle 24 oz",
            "category": "Home & Kitchen",
            "sub_category": "Water Bottles",
            "brand": "Owala",
            "price": 27.99,
            "original_price": 32.99,
            "currency": "USD",
            "sales_volume": 33800,
            "rating": 4.8,
            "review_count": 62110,
            "stock_status": "in_stock",
            "description": "Double-wall stainless steel bottle with a FreeSip spout for sipping or swigging, keeps drinks cold 24 hours.",
            "key_features": [
                "FreeSip spout - sip or swig",
                "Cold for up to 24 hours",
                "Push-button lid with lock",
                "Carry loop, cup-holder friendly",
            ],
            "image_url": "/static/img/owala-freesip.svg",
        },
        "order_template": {
            "order_id": "HS-24905",
            "product_id": "B09XKF3T2L",
            "order_status": "received_unconfirmed",
            "order_date_offset": -6,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223100055566",
            "estimated_delivery_offset": -3,
            "delivered_date_offset": -3,
            "last_tracking_scan_offset": -3,
            "last_tracking_event": "Left at front door - no signature",
            "shipping_address": "Calle Luna 27, 2A, 41010 Sevilla, ES",
            "quantity": 1,
            "amount_paid": 27.99,
        },
    },
    {
        "scenario_id": "return_completed_repurchase",
        "title": "Return finished, thinking of rebuying",
        "blurb": "Return wrapped up and the refund landed last week. Now the customer wants to know if they can buy the same monitor again at the sale price.",
        "image": "/static/img/lg-monitor.svg",
        "customer": {"name": "Renee Caldwell", "email": "renee.caldwell@example.com", "tier": "helios_plus"},
        "suggested_subject": "Refund received on HS-23310 - can I rebuy the monitor?",
        "suggested_body": (
            "Hi,\n\n"
            "Thanks - the refund for my returned monitor (order HS-23310) came through last week and "
            "everything looks settled on my end.\n\n"
            "I actually regret sending it back. Can I still order the same LG 27\" at the price I paid, "
            "and is my original order fully closed now?\n\n"
            "Renee"
        ),
        "product": {
            "product_id": "B0BQ5J4K7C",
            "product_name": "LG 27GR75Q 27\" QHD IPS Monitor",
            "category": "Electronics",
            "sub_category": "Monitors",
            "brand": "LG",
            "price": 229.99,
            "original_price": 299.99,
            "currency": "USD",
            "sales_volume": 5200,
            "rating": 4.6,
            "review_count": 8740,
            "stock_status": "in_stock",
            "description": "27-inch QHD IPS gaming monitor with 165Hz refresh, 1ms response, and HDR10 support.",
            "key_features": [
                "2560x1440 QHD IPS panel",
                "165Hz refresh rate",
                "1ms (GtG) response",
                "HDR10, height-adjustable stand",
            ],
            "image_url": "/static/img/lg-monitor.svg",
        },
        "order_template": {
            "order_id": "HS-23310",
            "product_id": "B0BQ5J4K7C",
            "order_status": "return_completed",
            "order_date_offset": -32,
            "payment_status": "refunded",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10222233344",
            "estimated_delivery_offset": -26,
            "delivered_date_offset": -26,
            "return_received_offset": -10,
            "refund_completed_offset": -7,
            "refund_amount": 229.99,
            "refund_method": "Visa ending 8842",
            "shipping_address": "640 Oak Ridge Dr, Denver, CO 80220, US",
            "quantity": 1,
            "amount_paid": 229.99,
        },
    },
    # --- Pet Supplies ------------------------------------------------------
    {
        "scenario_id": "pet_food_pre_order",
        "title": "Pre-order: is this food chicken-free?",
        "blurb": "No order yet. A shopper with an allergy-prone dog wants the ingredient list confirmed, and asks whether an opened bag can go back if the dog refuses it.",
        "image": "/static/img/proplan-salmon.svg",
        "customer": {"name": "Nadia Haddad", "email": "nadia.haddad@example.com", "tier": "standard"},
        "suggested_subject": "Does the salmon formula contain any chicken?",
        "suggested_body": (
            "Hi,\n\n"
            "My dog reacts badly to poultry, so before I buy the 30 lb salmon bag I need to be sure there's "
            "no chicken fat or chicken meal in it. The listing only shows the first few ingredients.\n\n"
            "Also, it says only a few bags left at $74.98 - if I order tomorrow instead, do I still get that "
            "price? And if I open the bag and he won't touch it, can I send it back?\n\n"
            "Thanks,\nNadia"
        ),
        "product": {
            "product_id": "B01N0T2QDC",
            "product_name": "Purina Pro Plan Sensitive Skin & Stomach Salmon & Rice, 30 lb",
            "category": "Pet Supplies",
            "sub_category": "Dry Dog Food",
            "brand": "Purina Pro Plan",
            "price": 74.98,
            "original_price": 84.99,
            "currency": "USD",
            "sales_volume": 15600,
            "rating": 4.7,
            "review_count": 41230,
            "stock_status": "low_stock",
            "description": "Salmon-first dry dog food with oatmeal and prebiotic fibre, formulated for dogs with sensitive skin and digestion.",
            "key_features": [
                "Real salmon is the first ingredient",
                "No poultry by-product meal",
                "Guaranteed live probiotics",
                "Omega-6 and zinc for skin and coat",
            ],
            "image_url": "/static/img/proplan-salmon.svg",
        },
        "order_template": {
            "order_id": None,
            "product_id": "B01N0T2QDC",
            "order_status": "pre_order_inquiry",
            "order_date_offset": None,
            "payment_status": "not_ordered",
            "shipping_carrier": None,
            "tracking_number": None,
            "estimated_delivery_offset": None,
            "delivered_date_offset": None,
            "shipping_address": None,
            "quantity": None,
            "amount_paid": None,
        },
    },
    {
        "scenario_id": "pet_fountain_damaged",
        "title": "Cat fountain arrived cracked",
        "blurb": "Delivered yesterday with a split reservoir that leaks onto the floor. Well inside the 48-hour damage window.",
        "image": "/static/img/petlibro-fountain.svg",
        "customer": {"name": "Owen Brady", "email": "owen.brady@example.com", "tier": "standard"},
        "suggested_subject": "Water fountain leaking out of the box - HS-25242",
        "suggested_body": (
            "Hi,\n\n"
            "The cat fountain arrived yesterday and there's a hairline crack down the side of the plastic "
            "reservoir. I filled it once and it emptied onto my kitchen floor within an hour. The shipping "
            "box had a hole punched in one side.\n\n"
            "My cat won't drink from a bowl, so I need a working one quickly. Do I have to ship the broken "
            "one back before you send a new one?\n\n"
            "Owen"
        ),
        "product": {
            "product_id": "B09KTMHRPT",
            "product_name": "PETLIBRO Granary Stainless Steel Cat Water Fountain 2.5 L",
            "category": "Pet Supplies",
            "sub_category": "Cat Water Fountains",
            "brand": "PETLIBRO",
            "price": 45.99,
            "original_price": 59.99,
            "currency": "USD",
            "sales_volume": 8900,
            "rating": 4.6,
            "review_count": 19870,
            "stock_status": "in_stock",
            "description": "2.5-litre stainless steel pet fountain with a triple-layer filter and a pump rated under 40 dB.",
            "key_features": [
                "304 stainless steel drinking surface",
                "Triple-layer carbon and cotton filter",
                "Under 40 dB pump",
                "Water level window, runs 2 weeks per fill",
            ],
            "image_url": "/static/img/petlibro-fountain.svg",
        },
        "order_template": {
            "order_id": "HS-25242",
            "product_id": "B09KTMHRPT",
            "order_status": "delivered",
            "order_date_offset": -6,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "394471028855",
            "estimated_delivery_offset": -1,
            "delivered_date_offset": -1,
            "shipping_address": "18 Harborview Rd, Providence, RI 02903, US",
            "quantity": 1,
            "amount_paid": 45.99,
            "condition_reported": "damaged_in_transit",
        },
    },
    {
        "scenario_id": "pet_harness_wrong_size",
        "title": "Wrong harness size shipped",
        "blurb": "Ordered a large harness for a 30 kg dog, received an extra-small in the wrong colour. Fulfilment error, and the customer leaves for a trip soon.",
        "image": "/static/img/ruffwear-harness.svg",
        "customer": {"name": "Kayla Nguyen", "email": "k.nguyen@example.com", "tier": "standard"},
        "suggested_subject": "Sent an XS harness instead of the L - HS-24660",
        "suggested_body": (
            "Hello,\n\n"
            "Order HS-24660 was supposed to be the Front Range harness in Blue Dusk, size L. What turned up "
            "is an XS in red - it doesn't go halfway around my dog's chest. The packing slip says L, so it "
            "looks like the wrong one went in the box.\n\n"
            "We're driving to Colorado in nine days and he can't ride without it. Can you get the right size "
            "out to me, and am I paying to send this one back?\n\n"
            "Kayla"
        ),
        "product": {
            "product_id": "B07TL2Z9Q4",
            "product_name": "Ruffwear Front Range Dog Harness (Blue Dusk, Large)",
            "category": "Pet Supplies",
            "sub_category": "Dog Harnesses",
            "brand": "Ruffwear",
            "price": 49.95,
            "original_price": 49.95,
            "currency": "USD",
            "sales_volume": 6300,
            "rating": 4.8,
            "review_count": 27640,
            "stock_status": "in_stock",
            "description": "Everyday padded dog harness with two leash attachment points, reflective trim, and an ID pocket.",
            "key_features": [
                "Four-point adjustable fit",
                "Aluminium V-ring on the back, reinforced webbing loop at the chest",
                "Reflective trim for low light",
                "Padded chest and belly panel",
            ],
            "image_url": "/static/img/ruffwear-harness.svg",
        },
        "order_template": {
            "order_id": "HS-24660",
            "product_id": "B07TL2Z9Q4",
            "order_status": "delivered",
            "order_date_offset": -10,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223104488213",
            "estimated_delivery_offset": -4,
            "delivered_date_offset": -4,
            "shipping_address": "3307 W 12th St, Kansas City, MO 64101, US",
            "quantity": 1,
            "amount_paid": 49.95,
            "condition_reported": "wrong_item_received",
            "item_received": "Front Range Harness - XS / Red Sumac (SKU RW-FR-XS-RED)",
        },
    },
    {
        "scenario_id": "pet_litter_box_lost",
        "title": "Litter box never arrived",
        "blurb": "A $649 automatic litter box with no carrier scan for 9 days and 8 days past the estimate. Past the point where Helios treats the parcel as lost.",
        "image": "/static/img/litter-robot.svg",
        "customer": {"name": "Marisol Ibáñez", "email": "marisol.ibanez@example.com", "tier": "standard"},
        "suggested_subject": "El pedido HS-25025 no ha llegado y son 649 dólares",
        "suggested_body": (
            "Buenos días,\n\n"
            "El arenero automático tenía que llegar hace más de una semana y el seguimiento no se mueve "
            "desde hace nueve días: sigue diciendo \"En tránsito - Memphis, TN\".\n\n"
            "Son 649 dólares y ya tiré el arenero viejo contando con este. No quiero esperar más a que "
            "aparezca. ¿Me lo pueden reenviar o devolverme el dinero?\n\n"
            "Marisol"
        ),
        "product": {
            "product_id": "B0BR8N7YXS",
            "product_name": "Litter-Robot 4 Automatic Self-Cleaning Litter Box",
            "category": "Pet Supplies",
            "sub_category": "Automatic Litter Boxes",
            "brand": "Whisker",
            "price": 649.00,
            "original_price": 699.00,
            "currency": "USD",
            "sales_volume": 2100,
            "rating": 4.4,
            "review_count": 9120,
            "stock_status": "in_stock",
            "description": "WiFi-connected self-cleaning litter box with OmniSense weight detection and a sealed waste drawer.",
            "key_features": [
                "Sifts automatically after each use",
                "OmniSense laser and weight sensing",
                "Tracks weight and litter box habits per cat in the app",
                "Carbon-filtered sealed waste drawer",
            ],
            "image_url": "/static/img/litter-robot.svg",
        },
        "order_template": {
            "order_id": "HS-25025",
            "product_id": "B0BR8N7YXS",
            "order_status": "in_transit",
            "order_date_offset": -16,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "884203176590",
            "estimated_delivery_offset": -8,
            "delivered_date_offset": None,
            "last_tracking_scan_offset": -9,
            "last_tracking_event": "In transit - Memphis, TN",
            "shipping_address": "Paseo de Gracia 91, 4D, 08008 Barcelona, ES",
            "quantity": 1,
            "amount_paid": 649.00,
        },
    },
    {
        "scenario_id": "pet_tracker_warranty",
        "title": "GPS tracker battery dies in hours",
        "blurb": "Bought 7 months ago. Battery went from days to a few hours, so it is out of the return window but inside the 12-month warranty.",
        "image": "/static/img/tractive-gps.svg",
        "customer": {"name": "Ethan Vogel", "email": "ethan.vogel@example.com", "tier": "standard"},
        "suggested_subject": "Tracker only lasts 3 hours now - order HS-22190",
        "suggested_body": (
            "Hello,\n\n"
            "I've had this GPS tracker on my dog's collar since the winter and it used to run four or five "
            "days per charge. For the last two weeks it dies after about three hours, and this morning it "
            "went flat while he was out of the yard.\n\n"
            "I've already reset it and reinstalled the app, so I don't think it's software. The whole point "
            "of it is that it stays on. What can you do here?\n\n"
            "Ethan"
        ),
        "product": {
            "product_id": "B0BLQ8Y3JD",
            "product_name": "Tractive GPS DOG 4 Tracker",
            "category": "Pet Supplies",
            "sub_category": "Pet GPS Trackers",
            "brand": "Tractive",
            "price": 49.99,
            "original_price": 59.99,
            "currency": "USD",
            "sales_volume": 11200,
            "rating": 4.3,
            "review_count": 15880,
            "stock_status": "in_stock",
            "description": "LTE collar tracker with live location, virtual fence alerts, and activity tracking. Requires a subscription.",
            "key_features": [
                "Live GPS tracking with unlimited range",
                "Virtual fence escape alerts",
                "Up to 7 days of battery per charge",
                "Waterproof, fits collars up to 4 cm wide",
            ],
            "image_url": "/static/img/tractive-gps.svg",
        },
        "order_template": {
            "order_id": "HS-22190",
            "product_id": "B0BLQ8Y3JD",
            "order_status": "delivered",
            "order_date_offset": -218,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223188771004",
            "estimated_delivery_offset": -213,
            "delivered_date_offset": -213,
            "shipping_address": "52 Larkspur Ct, Boise, ID 83702, US",
            "quantity": 1,
            "amount_paid": 49.99,
            "condition_reported": "battery_failure",
        },
    },
    {
        "scenario_id": "pet_bed_return_expired",
        "title": "Dog bed return, 38 days on",
        "blurb": "Delivered 38 days ago, used and undamaged - the dog simply refuses to sleep on it. Past the 30-day change-of-mind window.",
        "image": "/static/img/furhaven-bed.svg",
        "customer": {"name": "Álvaro Sandoval", "email": "alvaro.sandoval@example.com", "tier": "standard"},
        "suggested_subject": "Devolución de la cama para perro - HS-23615",
        "suggested_body": (
            "Hola,\n\n"
            "Compré la cama ortopédica hace algo más de un mes y mi perra no se echa en ella ni una vez. "
            "No está rota ni sucia, simplemente no la usa y ocupa medio salón.\n\n"
            "El pedido es HS-23615. Guardo la funda y la etiqueta. Quiero devolverla y que me reembolsen "
            "los 54,99 dólares a la tarjeta.\n\n"
            "Un saludo,\nÁlvaro"
        ),
        "product": {
            "product_id": "B073VBJ3DH",
            "product_name": "Furhaven Orthopedic Sofa Dog Bed (Large)",
            "category": "Pet Supplies",
            "sub_category": "Dog Beds",
            "brand": "Furhaven",
            "price": 54.99,
            "original_price": 74.99,
            "currency": "USD",
            "sales_volume": 14300,
            "rating": 4.5,
            "review_count": 38400,
            "stock_status": "in_stock",
            "description": "Large orthopedic dog bed with an egg-crate foam base, three-sided bolster, and a removable washable cover.",
            "key_features": [
                "Egg-crate orthopedic foam base",
                "Three-sided bolster for head and neck support",
                "Removable machine-washable cover",
                "Fits dogs up to 35 kg",
            ],
            "image_url": "/static/img/furhaven-bed.svg",
        },
        "order_template": {
            "order_id": "HS-23615",
            "product_id": "B073VBJ3DH",
            "order_status": "delivered",
            "order_date_offset": -43,
            "payment_status": "paid",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10744120099",
            "estimated_delivery_offset": -38,
            "delivered_date_offset": -38,
            "shipping_address": "Calle Serrano 145, 1C, 28006 Madrid, ES",
            "quantity": 1,
            "amount_paid": 54.99,
            "condition_reported": "opened_no_defect",
        },
    },
    # --- QA: one scenario per human-review rule, for manually verifying ------
    # tags._apply_review_rules(). Each blurb names the rule it's meant to trip
    # so you know what to expect before you send it. Not real catalog data —
    # safe to delete once you're done testing.
    {
        "scenario_id": "qa_account_hacked",
        "title": "[QA] Fraud keywords + sensitive intent",
        "blurb": "Should trip the fraud-keyword rule ('hacked', 'unauthorized charge') and likely classify as account_security, a rule-B sensitive intent.",
        "image": "/static/img/mx-master.svg",
        "customer": {"name": "Jamie Chen", "email": "jamie.chen@example.com", "tier": "standard"},
        "suggested_subject": "Unauthorized charge - I never placed this order",
        "suggested_body": (
            "Hi,\n\n"
            "I just found a charge on my card for an order I never placed. I think someone hacked "
            "into my account and used my saved payment method. Please cancel this order immediately "
            "and secure my account.\n\n"
            "Jamie"
        ),
        "product": {
            "product_id": "QA-HACK-01",
            "product_name": "Logitech MX Master 3S Wireless Mouse (Graphite)",
            "category": "Electronics",
            "sub_category": "Computer Mice",
            "brand": "Logitech",
            "price": 99.99,
            "original_price": 119.99,
            "currency": "USD",
            "sales_volume": 15400,
            "rating": 4.7,
            "review_count": 18902,
            "stock_status": "in_stock",
            "description": "8K DPI quiet-click wireless mouse with MagSpeed scrolling.",
            "key_features": ["8,000 DPI", "Quiet Click buttons", "MagSpeed scroll wheel"],
            "image_url": "/static/img/mx-master.svg",
        },
        "order_template": {
            "order_id": "HS-90001",
            "product_id": "QA-HACK-01",
            "order_status": "paid_unshipped",
            "order_date_offset": 0,
            "payment_status": "paid",
            "shipping_carrier": None,
            "tracking_number": None,
            "estimated_delivery_offset": 4,
            "delivered_date_offset": None,
            "shipping_address": "500 Test Ave, Testville, CA 90000, US",
            "quantity": 1,
            "amount_paid": 99.99,
        },
    },
    {
        "scenario_id": "qa_angry_legal_threat",
        "title": "[QA] Legal keywords + angry/critical",
        "blurb": "Should trip the legal-keyword rule ('lawyer', 'chargeback') and the sentiment+urgency rule (angry + critical).",
        "image": "/static/img/eufy-vacuum.svg",
        "customer": {"name": "Robert Klein", "email": "robert.klein@example.com", "tier": "standard"},
        "suggested_subject": "This is unacceptable - contacting my lawyer",
        "suggested_body": (
            "This is the third time this vacuum has broken down and nobody has actually fixed "
            "anything. I am absolutely furious about how this has been handled. If this isn't "
            "resolved today I am filing a chargeback with my bank and speaking to my lawyer about "
            "this. This is completely unacceptable.\n\n"
            "Robert"
        ),
        "product": {
            "product_id": "QA-LEGAL-01",
            "product_name": "eufy RoboVac 11S Max Robot Vacuum",
            "category": "Home & Kitchen",
            "sub_category": "Robot Vacuums",
            "brand": "eufy",
            "price": 199.99,
            "original_price": 249.99,
            "currency": "USD",
            "sales_volume": 7400,
            "rating": 4.5,
            "review_count": 29800,
            "stock_status": "in_stock",
            "description": "Slim 2000Pa robot vacuum with BoostIQ and 100-minute runtime.",
            "key_features": ["2000Pa suction", "100-minute runtime", "Slim body"],
            "image_url": "/static/img/eufy-vacuum.svg",
        },
        "order_template": {
            "order_id": "HS-90002",
            "product_id": "QA-LEGAL-01",
            "order_status": "delivered",
            "order_date_offset": -40,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "770199001122",
            "estimated_delivery_offset": -35,
            "delivered_date_offset": -35,
            "shipping_address": "9 Belmont Rd, Austin, TX 78704, US",
            "quantity": 1,
            "amount_paid": 199.99,
        },
    },
    {
        "scenario_id": "qa_product_fire_hazard",
        "title": "[QA] Product-safety keywords",
        "blurb": "Should trip the safety-keyword rule ('smoke', 'burning') — a product-safety incident.",
        "image": "/static/img/anker737.svg",
        "customer": {"name": "Nina Popov", "email": "nina.popov@example.com", "tier": "standard"},
        "suggested_subject": "Power bank got hot and started smoking",
        "suggested_body": (
            "Hi,\n\n"
            "I was charging my phone overnight with this power bank and woke up to a strange "
            "smell - it was hot to the touch and there was smoke coming from one corner. I "
            "unplugged it right away. It smelled like something was burning and this feels like a "
            "real fire hazard.\n\n"
            "Nina"
        ),
        "product": {
            "product_id": "QA-FIRE-01",
            "product_name": "Anker 737 Power Bank (PowerCore 24K)",
            "category": "Electronics",
            "sub_category": "Portable Chargers",
            "brand": "Anker",
            "price": 89.99,
            "original_price": 109.99,
            "currency": "USD",
            "sales_volume": 4300,
            "rating": 4.7,
            "review_count": 6821,
            "stock_status": "in_stock",
            "description": "24,000mAh power bank with 140W output.",
            "key_features": ["140W max output", "Digital display", "Fast charging"],
            "image_url": "/static/img/anker737.svg",
        },
        "order_template": {
            "order_id": "HS-90003",
            "product_id": "QA-FIRE-01",
            "order_status": "delivered",
            "order_date_offset": -5,
            "payment_status": "paid",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10900003331",
            "estimated_delivery_offset": -4,
            "delivered_date_offset": -4,
            "shipping_address": "77 Maple Street, Portland, OR 97205, US",
            "quantity": 1,
            "amount_paid": 89.99,
        },
    },
    {
        "scenario_id": "qa_request_manager",
        "title": "[QA] Explicit request for a human",
        "blurb": "Should trip the human-escalation-keyword rule ('speak to a manager', 'real person').",
        "image": "/static/img/keychron-k8.svg",
        "customer": {"name": "Sam Osei", "email": "sam.osei@example.com", "tier": "standard"},
        "suggested_subject": "I need to speak to a manager",
        "suggested_body": (
            "I've emailed twice already about my missing keyboard order and just gotten generic "
            "replies. I don't want another automated response - I want to speak to a manager or a "
            "real person who can actually resolve this.\n\n"
            "Sam"
        ),
        "product": {
            "product_id": "QA-ESC-01",
            "product_name": "Keychron K8 Wireless Mechanical Keyboard",
            "category": "Electronics",
            "sub_category": "Keyboards",
            "brand": "Keychron",
            "price": 89.00,
            "original_price": 99.00,
            "currency": "USD",
            "sales_volume": 8100,
            "rating": 4.7,
            "review_count": 12440,
            "stock_status": "in_stock",
            "description": "Tenkeyless hot-swappable mechanical keyboard.",
            "key_features": ["Hot-swappable switches", "Bluetooth 5.1", "240h battery"],
            "image_url": "/static/img/keychron-k8.svg",
        },
        "order_template": {
            "order_id": "HS-90004",
            "product_id": "QA-ESC-01",
            "order_status": "in_transit",
            "order_date_offset": -6,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223190004",
            "estimated_delivery_offset": -1,
            "delivered_date_offset": None,
            "last_tracking_scan_offset": -2,
            "last_tracking_event": "In transit - regional hub",
            "shipping_address": "215 Birch Ave, Apt 2, Seattle, WA 98103, US",
            "quantity": 1,
            "amount_paid": 89.00,
        },
    },
    {
        "scenario_id": "qa_social_media_threat",
        "title": "[QA] Reputation-risk keywords",
        "blurb": "Should trip the reputation-keyword rule ('social media', 'leave a bad review').",
        "image": "/static/img/owala-freesip.svg",
        "customer": {"name": "Casey Fields", "email": "casey.fields@example.com", "tier": "standard"},
        "suggested_subject": "Not happy - going to post about this",
        "suggested_body": (
            "This bottle arrived leaking and customer service has ignored my last email for a "
            "week. If this isn't fixed I'm going to post about it on social media and leave a bad "
            "review everywhere I can find. Other customers deserve to know.\n\n"
            "Casey"
        ),
        "product": {
            "product_id": "QA-REP-01",
            "product_name": "Owala FreeSip Insulated Water Bottle 24 oz",
            "category": "Home & Kitchen",
            "sub_category": "Water Bottles",
            "brand": "Owala",
            "price": 27.99,
            "original_price": 32.99,
            "currency": "USD",
            "sales_volume": 33800,
            "rating": 4.8,
            "review_count": 62110,
            "stock_status": "in_stock",
            "description": "Double-wall stainless steel bottle with a FreeSip spout.",
            "key_features": ["FreeSip spout", "Cold 24 hours", "Push-button lid"],
            "image_url": "/static/img/owala-freesip.svg",
        },
        "order_template": {
            "order_id": "HS-90005",
            "product_id": "QA-REP-01",
            "order_status": "delivered",
            "order_date_offset": -8,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223190005",
            "estimated_delivery_offset": -6,
            "delivered_date_offset": -6,
            "shipping_address": "Calle Luna 27, 2A, 41010 Sevilla, ES",
            "quantity": 1,
            "amount_paid": 27.99,
        },
    },
    {
        "scenario_id": "qa_privacy_delete_request",
        "title": "[QA] Privacy/compliance keywords",
        "blurb": "Should trip the privacy-keyword rule ('GDPR', 'delete my data').",
        "image": "/static/img/kindle-paperwhite.svg",
        "customer": {"name": "Priya Desai", "email": "priya.desai@example.com", "tier": "standard"},
        "suggested_subject": "GDPR request - please delete my data",
        "suggested_body": (
            "Hello,\n\n"
            "Under GDPR I am formally requesting that you delete my data from your systems "
            "entirely, including my order history, account details, and any saved payment "
            "information.\n\n"
            "Priya"
        ),
        "product": {
            "product_id": "QA-PRIV-01",
            "product_name": "Kindle Paperwhite (16 GB, 6.8\" display)",
            "category": "Electronics",
            "sub_category": "E-readers",
            "brand": "Amazon",
            "price": 149.99,
            "original_price": 159.99,
            "currency": "USD",
            "sales_volume": 26500,
            "rating": 4.7,
            "review_count": 51230,
            "stock_status": "in_stock",
            "description": "6.8-inch glare-free e-reader with adjustable warm light.",
            "key_features": ["6.8\" display", "IPX8 waterproof", "Weeks of battery"],
            "image_url": "/static/img/kindle-paperwhite.svg",
        },
        "order_template": {
            "order_id": "HS-90006",
            "product_id": "QA-PRIV-01",
            "order_status": "delivered",
            "order_date_offset": -20,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "612093847790006",
            "estimated_delivery_offset": -18,
            "delivered_date_offset": -18,
            "shipping_address": "215 Birch Ave, Apt 2, Seattle, WA 98103, US",
            "quantity": 1,
            "amount_paid": 149.99,
        },
    },
    {
        "scenario_id": "qa_high_value_order",
        "title": "[QA] High order value",
        "blurb": "Should trip the high-order-value rule ($999 >= $300 threshold) — otherwise a routine, low-drama shipping question.",
        "image": "/static/img/lg-monitor.svg",
        "customer": {"name": "Victor Huang", "email": "victor.huang@example.com", "tier": "standard"},
        "suggested_subject": "Just checking on my monitor's delivery",
        "suggested_body": (
            "Hi,\n\n"
            "I ordered this monitor three days ago and tracking still shows it in transit. No "
            "rush at all, just wondering roughly when it's expected to arrive.\n\n"
            "Victor"
        ),
        "product": {
            "product_id": "QA-HIGHVAL-01",
            "product_name": "LG 27GR95QE-B 27\" OLED Gaming Monitor",
            "category": "Electronics",
            "sub_category": "Monitors",
            "brand": "LG",
            "price": 999.00,
            "original_price": 1199.00,
            "currency": "USD",
            "sales_volume": 1900,
            "rating": 4.6,
            "review_count": 3120,
            "stock_status": "in_stock",
            "description": "27-inch OLED gaming monitor with 240Hz refresh and 0.03ms response.",
            "key_features": ["OLED panel", "240Hz refresh", "0.03ms response"],
            "image_url": "/static/img/lg-monitor.svg",
        },
        "order_template": {
            "order_id": "HS-90007",
            "product_id": "QA-HIGHVAL-01",
            "order_status": "in_transit",
            "order_date_offset": -3,
            "payment_status": "paid",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10900007771",
            "estimated_delivery_offset": 2,
            "delivered_date_offset": None,
            "last_tracking_scan_offset": -1,
            "last_tracking_event": "In transit - regional hub",
            "shipping_address": "640 Oak Ridge Dr, Denver, CO 80220, US",
            "quantity": 1,
            "amount_paid": 999.00,
        },
    },
    {
        "scenario_id": "qa_vip_unhappy",
        "title": "[QA] VIP member + negative sentiment",
        "blurb": "Should trip the Helios Plus + negative-sentiment rule — order value stays low on purpose so it doesn't also trip the high-value rule.",
        "image": "/static/img/instant-pot.svg",
        "customer": {"name": "Helena Ward", "email": "helena.ward@example.com", "tier": "helios_plus"},
        "suggested_subject": "Second defective item in a row - very frustrated",
        "suggested_body": (
            "I've been a Helios Plus member for two years and this is the second defective item "
            "I've received in a row. I'm extremely frustrated and honestly considering cancelling "
            "my membership over this.\n\n"
            "Helena"
        ),
        "product": {
            "product_id": "QA-VIP-01",
            "product_name": "Instant Pot Duo Plus 6 Qt Pressure Cooker",
            "category": "Home & Kitchen",
            "sub_category": "Pressure Cookers",
            "brand": "Instant Pot",
            "price": 79.99,
            "original_price": 99.99,
            "currency": "USD",
            "sales_volume": 18700,
            "rating": 4.6,
            "review_count": 45900,
            "stock_status": "in_stock",
            "description": "9-in-1 electric pressure cooker with 15 programs.",
            "key_features": ["9 appliances in one", "15 programs", "Stainless steel pot"],
            "image_url": "/static/img/instant-pot.svg",
        },
        "order_template": {
            "order_id": "HS-90008",
            "product_id": "QA-VIP-01",
            "order_status": "delivered",
            "order_date_offset": -10,
            "payment_status": "paid",
            "shipping_carrier": "UPS",
            "tracking_number": "1Z999AA10900008881",
            "estimated_delivery_offset": -8,
            "delivered_date_offset": -8,
            "shipping_address": "Av. Diagonal 402, 08037 Barcelona, ES",
            "quantity": 1,
            "amount_paid": 79.99,
        },
    },
    {
        "scenario_id": "qa_damage_reported_late",
        "title": "[QA] Damage reported outside the 2-day window",
        "blurb": "Should trip the damage-report-window rule — condition is damaged_in_transit but reported 10 days after delivery, past the 2-day window.",
        "image": "/static/img/petlibro-fountain.svg",
        "customer": {"name": "Derek Simmons", "email": "derek.simmons@example.com", "tier": "standard"},
        "suggested_subject": "Sorry for the late report - arrived cracked",
        "suggested_body": (
            "Hi,\n\n"
            "I meant to email about this sooner, but the water fountain arrived with a cracked "
            "reservoir about a week and a half ago and I only just got around to reporting it. Is "
            "a replacement still possible at this point?\n\n"
            "Derek"
        ),
        "product": {
            "product_id": "QA-LATEDMG-01",
            "product_name": "PETLIBRO Granary Stainless Steel Cat Water Fountain 2.5 L",
            "category": "Pet Supplies",
            "sub_category": "Cat Water Fountains",
            "brand": "PETLIBRO",
            "price": 45.99,
            "original_price": 59.99,
            "currency": "USD",
            "sales_volume": 8900,
            "rating": 4.6,
            "review_count": 19870,
            "stock_status": "in_stock",
            "description": "2.5-litre stainless steel pet fountain with a triple-layer filter.",
            "key_features": ["Stainless steel", "Triple-layer filter", "Under 40 dB pump"],
            "image_url": "/static/img/petlibro-fountain.svg",
        },
        "order_template": {
            "order_id": "HS-90009",
            "product_id": "QA-LATEDMG-01",
            "order_status": "delivered",
            "order_date_offset": -12,
            "payment_status": "paid",
            "shipping_carrier": "FedEx",
            "tracking_number": "394471028900009",
            "estimated_delivery_offset": -10,
            "delivered_date_offset": -10,
            "shipping_address": "18 Harborview Rd, Providence, RI 02903, US",
            "quantity": 1,
            "amount_paid": 45.99,
            "condition_reported": "damaged_in_transit",
        },
    },
    {
        "scenario_id": "qa_warranty_and_return_expired",
        "title": "[QA] Past both return window and warranty",
        "blurb": "Should trip the expired-warranty rule — delivered over 400 days ago, so both the 30-day return window and the 12-month warranty have lapsed.",
        "image": "/static/img/tractive-gps.svg",
        "customer": {"name": "Louisa Ferreira", "email": "louisa.ferreira@example.com", "tier": "standard"},
        "suggested_subject": "Battery completely dead after over a year",
        "suggested_body": (
            "Hello,\n\n"
            "This GPS tracker's battery has completely stopped holding a charge. I've had it for "
            "a little over a year now, so I know it's well past the return window, but I was "
            "hoping something could still be done.\n\n"
            "Louisa"
        ),
        "product": {
            "product_id": "QA-OLDWARR-01",
            "product_name": "Tractive GPS DOG 4 Tracker",
            "category": "Pet Supplies",
            "sub_category": "Pet GPS Trackers",
            "brand": "Tractive",
            "price": 49.99,
            "original_price": 59.99,
            "currency": "USD",
            "sales_volume": 11200,
            "rating": 4.3,
            "review_count": 15880,
            "stock_status": "in_stock",
            "description": "LTE collar tracker with live location and virtual fence alerts.",
            "key_features": ["Live GPS tracking", "Virtual fence alerts", "Waterproof"],
            "image_url": "/static/img/tractive-gps.svg",
        },
        "order_template": {
            "order_id": "HS-90010",
            "product_id": "QA-OLDWARR-01",
            "order_status": "delivered",
            "order_date_offset": -400,
            "payment_status": "paid",
            "shipping_carrier": "USPS",
            "tracking_number": "9400111899223190010",
            "estimated_delivery_offset": -395,
            "delivered_date_offset": -395,
            "shipping_address": "52 Larkspur Ct, Boise, ID 83702, US",
            "quantity": 1,
            "amount_paid": 49.99,
            "condition_reported": "battery_failure",
        },
    },
]

SCENARIOS_BY_ID = {s["scenario_id"]: s for s in SCENARIOS}

# Scenario titles and blurbs in the two non-source UI languages. English lives on
# the scenario itself and is the fallback for anything missing here.
#
# Only these two fields are translated: they are chrome the user reads to pick a
# scenario. The email bodies, product names and order records stay in their
# original language on purpose — they are the data under test, and a Spanish
# customer email is part of the scenario, not a localisation of it.
TRANSLATIONS: dict[str, dict[str, dict[str, str]]] = {
    "pre_order_inquiry": {
        "zh": {"title": "购前咨询",
               "blurb": "还没有订单。买家在比较充电宝，想在缺货前确认能不能给笔记本充电。"},
        "es": {"title": "Consulta previa a la compra",
               "blurb": "Aún no hay pedido. El comprador compara baterías externas y quiere saber si puede cargar un portátil antes de que se agote el stock."},
    },
    "shipment_delayed": {
        "zh": {"title": "物流卡在途中",
               "blurb": "已付款已发货，但运单 6 天没有更新，预计送达时间也已经过了。"},
        "es": {"title": "Envío detenido en tránsito",
               "blurb": "Pagado y enviado, pero el seguimiento no se actualiza desde hace 6 días y la fecha estimada ya pasó."},
    },
    "damaged_on_arrival": {
        "zh": {"title": "到货破损",
               "blurb": "2 天前签收，外壳有裂缝，还在 48 小时报损窗口内。"},
        "es": {"title": "Llegó dañado",
               "blurb": "Entregado hace 2 días con la carcasa agrietada. Dentro del plazo de 48 horas para reportar daños."},
    },
    "wrong_item_shipped": {
        "zh": {"title": "发错货",
               "blurb": "下单的是无线 MX Master 3S，收到的却是有线廉价鼠标。是平台这边的履约失误。"},
        "es": {"title": "Enviaron el artículo equivocado",
               "blurb": "Pidió el MX Master 3S inalámbrico y recibió un ratón con cable barato. Error de preparación nuestro."},
    },
    "return_window_expired": {
        "zh": {"title": "退货窗口已关闭",
               "blurb": "签收 41 天，已拆封使用，无质量问题。已超出 30 天无理由退货期。"},
        "es": {"title": "El plazo de devolución ya cerró",
               "blurb": "Entregado hace 41 días, abierto y usado, sin defecto. Fuera del plazo de 30 días por arrepentimiento."},
    },
    "refund_pending": {
        "zh": {"title": "退款未到账",
               "blurb": "退货 9 天前已回到仓库，退款状态却仍显示处理中。"},
        "es": {"title": "El reembolso no llega",
               "blurb": "La devolución llegó al almacén hace 9 días y el reembolso sigue apareciendo como en proceso."},
    },
    "warranty_claim": {
        "zh": {"title": "用 5 个月后故障",
               "blurb": "已过退货期但仍在 12 个月保修内。电池充不进电了。"},
        "es": {"title": "Falla tras 5 meses",
               "blurb": "Fuera del plazo de devolución pero dentro de la garantía de 12 meses. La batería ya no aguanta la carga."},
    },
    "address_change_unshipped": {
        "zh": {"title": "发货前想改地址",
               "blurb": "一小时前付的款，刚发现寄到了旧公寓。想在出库前把地址改掉。"},
        "es": {"title": "Cambiar la dirección antes del envío",
               "blurb": "Pagó hace una hora y acaba de ver que el pedido va a su piso anterior. Quiere corregir la dirección antes de que salga del almacén."},
    },
    "arrived_awaiting_pickup": {
        "zh": {"title": "包裹在自提柜等取",
               "blurb": "运单显示两天前已投递到自提柜，但取件码一直没收到，App 里仍显示未送达。"},
        "es": {"title": "Esperando en el buzón de paquetes",
               "blurb": "El seguimiento dice que el paquete llegó a un buzón hace dos días, pero nunca llegó el código de apertura y la app sigue mostrándolo como no entregado."},
    },
    "received_not_confirmed": {
        "zh": {"title": "已收货但系统未确认",
               "blurb": "三天前无接触放在门口。客户已经拿到瓶子，但 App 仍显示在途，也点不了确认收货。"},
        "es": {"title": "Entregado pero sin confirmar",
               "blurb": "Entrega sin contacto en la puerta hace tres días. El cliente ya tiene la botella, pero la app sigue mostrando el pedido en tránsito y no le deja confirmar la recepción."},
    },
    "return_completed_repurchase": {
        "zh": {"title": "退货完成，想重新买",
               "blurb": "退货流程已结束，退款上周到账。现在客户想知道能不能按原价再买一台同款显示器。"},
        "es": {"title": "Devolución cerrada, quiere volver a comprar",
               "blurb": "La devolución terminó y el reembolso llegó la semana pasada. Ahora el cliente pregunta si puede comprar el mismo monitor al precio que pagó."},
    },
    "pet_food_pre_order": {
        "zh": {"title": "购前咨询：这款狗粮含鸡肉吗？",
               "blurb": "还没有订单。狗对禽类过敏的买家想确认配料表，并问拆封后狗不吃能不能退。"},
        "es": {"title": "Consulta previa: ¿este pienso lleva pollo?",
               "blurb": "Aún no hay pedido. Un comprador con un perro alérgico quiere confirmar los ingredientes y pregunta si puede devolver el saco abierto si su perro no lo come."},
    },
    "pet_fountain_damaged": {
        "zh": {"title": "猫饮水机到货开裂",
               "blurb": "昨天签收，水箱裂了一道缝，水漏了一地。远在 48 小时报损窗口内。"},
        "es": {"title": "La fuente para gatos llegó agrietada",
               "blurb": "Entregada ayer con el depósito partido y goteando al suelo. Muy dentro del plazo de 48 horas para reportar daños."},
    },
    "pet_harness_wrong_size": {
        "zh": {"title": "胸背带发错尺码",
               "blurb": "给 30 公斤的狗买了 L 号，收到的是 XS 号，颜色也不对。履约失误，而客户很快要出门。"},
        "es": {"title": "Enviaron el arnés en la talla equivocada",
               "blurb": "Pidió una talla L para un perro de 30 kg y recibió una XS en otro color. Error de preparación, y el cliente sale de viaje pronto."},
    },
    "pet_litter_box_lost": {
        "zh": {"title": "猫砂盆一直没到",
               "blurb": "649 美元的自动猫砂盆，运单 9 天没扫描，已超预计送达 8 天。到了判定丢件的线。"},
        "es": {"title": "El arenero nunca llegó",
               "blurb": "Un arenero automático de 649 dólares sin ningún escaneo desde hace 9 días y 8 días después de la fecha estimada. Pasado el punto en que Helios lo da por perdido."},
    },
    "pet_tracker_warranty": {
        "zh": {"title": "GPS 追踪器续航只剩几小时",
               "blurb": "7 个月前买的。续航从几天掉到几小时，已过退货期但仍在 12 个月保修内。"},
        "es": {"title": "El rastreador GPS se descarga en horas",
               "blurb": "Comprado hace 7 meses. La batería pasó de días a unas pocas horas, así que está fuera del plazo de devolución pero dentro de la garantía de 12 meses."},
    },
    "pet_bed_return_expired": {
        "zh": {"title": "狗窝送达 38 天后想退",
               "blurb": "签收 38 天，用过但没有损坏——狗就是不肯睡。已超 30 天无理由退货期。"},
        "es": {"title": "Devolución de la cama del perro, 38 días después",
               "blurb": "Entregada hace 38 días, usada y sin daños: el perro simplemente no se echa en ella. Fuera del plazo de 30 días por arrepentimiento."},
    },
}


def materialise(scenario_id: str, today: date | None = None) -> dict[str, Any] | None:
    """Turn a scenario template into a concrete product + order payload."""
    src = SCENARIOS_BY_ID.get(scenario_id)
    if src is None:
        return None
    today = today or date.today()
    tpl = copy.deepcopy(src["order_template"])

    order: dict[str, Any] = {}
    for key, value in tpl.items():
        if key.endswith("_offset"):
            order[key[: -len("_offset")]] = _iso(value, today)
        else:
            order[key] = value

    return {
        "scenario_id": src["scenario_id"],
        "title": src["title"],
        "blurb": src["blurb"],
        "i18n": copy.deepcopy(TRANSLATIONS.get(scenario_id, {})),
        "image": src["image"],
        "customer": copy.deepcopy(src["customer"]),
        "suggested_subject": src["suggested_subject"],
        "suggested_body": src["suggested_body"],
        "product": copy.deepcopy(src["product"]),
        "order": order,
    }


def list_scenarios(today: date | None = None) -> list[dict[str, Any]]:
    return [materialise(s["scenario_id"], today) for s in SCENARIOS]
