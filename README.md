# dish.ly Connect

**Embedded integrations for dish.ly, a multi-tenant restaurant POS built for Pakistan, powered by [Fastn](https://fastn.ai).**

Built for the Fastn Online Hackathon, 24 October 2026.

dish.ly is a live POS (dishly.wyibe.com) used by restaurants in Islamabad: QR self-ordering, a POS terminal, kitchen display, khata (credit tab) ledger, cash-drawer shifts with X/Z reports, and FBR tax fiscalization. **dish.ly Connect** adds an Integrations page inside the restaurant's admin, where each restaurant connects **its own** HubSpot, Slack, Google Sheets, Gmail and Google Drive through the Fastn widget. From then on, sales, guests and end-of-day reports flow into those tools on their own.

> **Declared extension of an existing project.** dish.ly itself existed before the hackathon. Everything in this repository (the integration layer, the Integrations page, the event outbox, the Fastn workflows, triggers and widget) was built on 24 October 2026. The dish.ly core repo is private because it runs paying restaurants; this public repo contains every file added or changed for the hackathon.

---

## The problem

A Pakistani restaurant owner's numbers are trapped inside the POS. Every night the manager screenshots the Z-report onto WhatsApp for the owner, the accountant re-types sales into a spreadsheet, nobody follows up with regulars, and khata balances are chased from memory.

Building integrations is how POS companies like Toast and Square keep restaurants, but for a 3-person team, building and maintaining OAuth apps, token storage and refresh, per-restaurant isolation, retries and a connect UI for five providers would take months.

## The customer

Restaurant owners and managers on dish.ly (non-technical). They click an app, sign in with their own account, and it is connected. Nobody at dish.ly ever connects an account on a restaurant's behalf.

## How it works

```
 dish.ly (Next.js, Neon Postgres)                         Fastn                         Restaurant's own apps
 ───────────────────────────────                          ─────                         ─────────────────────
 POS sale / void / refund / shift close
        │
        ▼
 IntegrationEvent outbox row  ──►  POST /api/v1/workflows/{id}/execute  ──►  workflow runs with  ──►  HubSpot contact
 (status, attempts, error)          x-end-org-id: <this restaurant>          THIS restaurant's         Slack alert
        ▲                                                                    connections only          Sheets row, Drive CSV
        └── Retry button on the Integrations page                                                      Gmail summary

 /admin/integrations  ──►  GET /api/admin/integrations/token  ──►  POST /api/v1/embed/token (server side)
   Fastn widget iframe  ◄──  tenant-scoped embed URL  ◄────────────  token for this restaurant only
```

* **One restaurant = one Fastn customer (tenant).** `IntegrationSettings.fastnEndOrgId` stores which Fastn customer a restaurant is.
* **The widget is tenant-scoped.** The embed token is minted on the server for the signed-in restaurant only, so the widget can only show and create that restaurant's connections. The Fastn API key never reaches the browser.
* **Every workflow call is tenant-scoped** with the `x-end-org-id` header. Restaurant A's sale can only ever reach restaurant A's HubSpot.
* **Outbox + retries.** Every event is written to `IntegrationEvent` first, delivered after the HTTP response (Next.js `after()`, so the till never waits), retried 3 times with exponential backoff on network errors, 429 and 5xx, and shown in a Sync history with a manual **Retry** button.
* **Configuration template with defaults.** Each restaurant starts from sensible defaults (big-order alert at PKR 10,000, `#dishly-alerts`, sheet name, which events to send) and can change them.

## Connectors (5, all real OAuth, all the restaurant's own accounts)

| Connector | What the restaurant gets | Trigger |
|---|---|---|
| HubSpot | Guest upserted as a contact (by phone) with an order note, so repeat diners show up in the CRM | every paid order |
| Slack | Manager alert in the restaurant's channel: big orders, voids, refunds, shift close, khata summary | order and shift events |
| Google Sheets | One Z-report row per shift (sales, tax, cash, card, wallet, khata, variance) in a sheet the accountant can use | shift close |
| Gmail | End-of-day summary to the owner, nightly khata (credit) report | shift close, nightly |
| Google Drive | Each Z-report saved as a CSV in the restaurant's Drive | shift close |

## Fastn pieces (in workspace "Ahmed.usman7615's Organization")

* **Integration:** dish.ly Connect
* **Workflows:** `dishly-order-paid`, `dishly-order-voided`, `dishly-shift-closed`, `dishly-khata-reminder`. Each one skips (and reports) any app the restaurant has not connected instead of failing the whole run.
* **Triggers:** called from dish.ly through the execute API per event; a nightly scheduler for khata reminders.
* **Widget:** the Fastn connect widget, embedded as an iframe in dish.ly's own admin UI.
* **Customers:** one per restaurant. Demo tenants: *Aanch Restaurant F6* and *Demo Diner* (test restaurants on dish.ly).
* Built with the **Fastn MCP** from Claude and the Fastn agent.

## Live app

* App: https://dishly.wyibe.com (Admin → Integrations). Test login is provided in the hackathon submission form.
* Fastn workflows: `dishly-order-paid` (wf_a6ea5baaaea7), `dishly-order-voided` (wf_15a8d314fb04), `dishly-shift-closed` (wf_63f12a34b57a), `dishly-khata-reminder` (wf_b38ca52a54be); widget `wgt_ac2530180e9e`.

## Two-tenant test

1. Two restaurants on dish.ly: **Aanch Restaurant F6** and **Demo Diner**, each mapped to its own Fastn customer.
2. Each connects a **different** HubSpot, Slack and Google account from its own Integrations page.
3. The same sale and the same shift close run the same Fastn workflows for both.
4. Aanch's Z-report lands only in Aanch's Google Sheet and Drive, Demo Diner's only in its own. Neither restaurant's widget lists the other's connections.

## Files

| File | Purpose |
|---|---|
| `src/lib/fastn.ts` | Fastn client: embed token minting, tenant resolution, outbox delivery with retries, payload builders |
| `src/app/admin/integrations/page.tsx` | The Integrations page (server) |
| `src/components/admin/IntegrationsHub.tsx` | Widget embed, recipes, settings, sync history with Retry |
| `src/app/api/admin/integrations/*` | Token, settings, test order, khata reminders, retry (owner/manager only, same-origin, tenant-scoped) |
| `src/app/api/cron/integrations-khata/route.ts` | Nightly khata reminders for every connected restaurant |
| `prisma/migrations/20261024120000_dishly_connect` | `IntegrationSettings` and `IntegrationEvent` tables (additive) |
| `CHANGES.md` | The hooks added to dish.ly's existing order, refund and shift routes |

## Setup

Environment variables on the dish.ly server:

```
FASTN_API_BASE=https://api.fastn.dev        # public API under /v1 (falls back to /api/v1)
FASTN_API_KEY=fsk_...                      # Fastn API key, server only
FASTN_ENV=test                             # Fastn environment the workflows run in
FASTN_WORKFLOWS={"order.paid":"<id>","order.cancelled":"<id>","order.refunded":"<id>","shift.closed":"<id>","khata.reminder":"<id>"}
FASTN_CUSTOMERS={"<restaurant slug>":"<fastn customer id>"}   # seeds the restaurant to tenant mapping
```

Then `npx prisma migrate deploy` and open **Admin → Integrations** as a restaurant owner.

## What's next

* Auto-provision a Fastn customer on restaurant signup (`POST /v1/orgs`) instead of the env map.
* Foodpanda order intake and QuickBooks/Xero daily sales journal.
* A WhatsApp Business connector so khata reminders reach customers directly.
