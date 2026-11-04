---
title: E-commerce data model
seo_title: E-commerce database design: ER diagram and schema
description: An example e-commerce data model with ER diagram — customers, addresses, product categories, products, carts, orders, order lines, payments and shipments — with a data dictionary and PostgreSQL DDL you can open and adapt.
section: Examples
order: 1
model: site/examples/ecommerce.json
---

This example models an online store from browsing to delivery: customers and their saved addresses, a product catalog organized in a category tree, shopping carts, orders with their lines, payments and shipments.

## Design notes

- **Orders keep the price that was charged.** `order_line.unit_price` and the totals on the order are stored, not looked up from the product, so later price changes don't rewrite history.
- **Carts and orders are separate.** A cart is temporary and can belong to a guest; an order is a permanent record that always has a customer and a shipping address.
- **Categories form a tree** through a relationship from `category` to itself (`parent_category_id`).
- **Payments are attempts.** An order can have several, including failed ones, so the relationship is many-to-one. Card numbers stay with the payment provider; only its reference is stored.
- **Shipments are separate from orders**, so one order can ship in several parcels.
- **Status, payment method, country and currency are reference lists** with their values, which become lookup tables and foreign keys in SQL.

To extend it: add `product_variant` for sizes and colors, `review` for product ratings, `promotion` and `coupon` for discounts, or `return_request` for returns.

<!-- example -->

## Frequently asked questions

### What tables does an e-commerce database need?

At minimum: customer, address, product, category, order (often named customer_order, since ORDER is a reserved word), order line, payment and shipment, plus lookup tables for order status and payment method. A cart and cart item support saved baskets before checkout.

### Why is the order table called customer_order?

ORDER is a reserved word in SQL, so naming the table customer_order avoids quoting it in every query. The display name is still Order.

### How do I store prices that change over time?

Store the price actually charged on each order line. For a full price history of the catalog, add a product_price table with effective-from and effective-to dates.
