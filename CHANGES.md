# Changes to existing dish.ly files

The full diff is in `CHANGES.diff`. In short:

* `prisma/schema.prisma`: adds `IntegrationSettings` and `IntegrationEvent` and their relations on `Restaurant`.
* `src/app/api/staff/pos/orders/route.ts`, `orders/[id]/charge`, `tables/[id]/charge-all`, `orders/manual`: emit `order.paid` after a sale is durable.
* `src/app/api/staff/orders/[id]/route.ts`: emits `order.cancelled` on a void.
* `src/app/api/staff/orders/[id]/refund/route.ts`: emits `order.refunded`.
* `src/app/api/staff/shifts/close/route.ts`: emits `shift.closed` with the frozen Z-report totals.
* `src/proxy.ts`: allows the Fastn widget in the Content-Security-Policy `frame-src`.
* `src/components/admin/AdminNav.tsx`: adds the Integrations link.
* `src/lib/backup.ts`: includes the two new tables in the nightly encrypted backup.

Every emit is fire-and-forget after the response, so a slow or failing integration can never block a sale.
