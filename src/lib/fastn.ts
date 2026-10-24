import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { log } from "./log";

/**
 * dish.ly Connect: embedded integrations powered by Fastn (fastn.ai).
 *
 * Model
 * -----
 * dish.ly is the SaaS partner in Fastn. Every restaurant is a Fastn customer
 * (an "end org"), so each restaurant connects ITS OWN HubSpot, Slack, Google
 * Sheets, Gmail and Drive through the Fastn widget embedded on
 * /admin/integrations. Nobody at dish.ly ever clicks "connect" on a
 * restaurant's behalf.
 *
 * dish.ly never calls HubSpot/Slack/Google directly. It only hands an event to
 * a Fastn workflow, scoped to the restaurant with the x-end-org-id header, and
 * Fastn runs it with that restaurant's own connections. That header is the
 * whole tenant boundary: restaurant A's event can only ever reach restaurant
 * A's accounts.
 *
 * Every event is written to IntegrationEvent first (an outbox), so the owner
 * sees a sync history and any failed delivery can be retried.
 */

export type IntegrationEventType =
  | "order.paid"
  | "order.cancelled"
  | "order.refunded"
  | "shift.closed"
  | "khata.reminder"
  | "test.ping";

const API_BASE = (process.env.FASTN_API_BASE || "https://api.fastn.dev").replace(/\/$/, "");

function apiKey() {
  return process.env.FASTN_API_KEY || "";
}

export function fastnConfigured() {
  return Boolean(apiKey() && workflowFor("order.paid"));
}

function baseHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
  if (apiKey().startsWith("fsk_test_")) h["X-fastn-Test-Mode"] = "true";
  return h;
}

/**
 * Fastn serves its public API under /v1 (what the dashboard's embed snippets
 * use); older docs show /api/v1. Try /v1 first and fall back on a 404 so a
 * path change on either side does not take integrations down.
 */
async function fastnFetch(path: string, init: RequestInit): Promise<Response> {
  const prefixes = process.env.FASTN_API_PREFIX ? [process.env.FASTN_API_PREFIX] : ["/v1", "/api/v1"];
  let res: Response | null = null;
  for (const prefix of prefixes) {
    res = await fetch(`${API_BASE}${prefix}${path}`, { ...init, cache: "no-store" });
    if (res.status !== 404) return res;
  }
  return res!;
}

/**
 * Which Fastn workflow handles which event. FASTN_WORKFLOWS is a JSON map
 * ({"order.paid":"<workflowId>", ...}); FASTN_WORKFLOW_DEFAULT catches the
 * rest, so one router workflow is also a valid setup.
 */
export function workflowFor(type: IntegrationEventType): string | null {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(process.env.FASTN_WORKFLOWS || "{}");
  } catch {
    log.warn("FASTN_WORKFLOWS is not valid JSON");
  }
  return map[type] || process.env.FASTN_WORKFLOW_DEFAULT || null;
}

/** Settings row for a restaurant, created with the default template on first use. */
export async function getIntegrationSettings(restaurantId: string) {
  return prisma.integrationSettings.upsert({
    where: { restaurantId },
    create: { restaurantId },
    update: {},
  });
}

/**
 * Mint a short-lived, tenant-scoped embed token for the Fastn widget. Runs on
 * the server only; the API key never reaches the browser.
 */
export async function mintEmbedToken(input: {
  endOrgId: string;
  userEmail?: string;
  userName?: string;
}): Promise<{ token: string } | { error: string }> {
  if (!apiKey()) return { error: "Integrations are not configured on this server yet." };
  try {
    // x-org-id names the customer (tenant); the token it returns can only
    // see and create that customer's connections.
    const res = await fastnFetch(`/embed/token`, {
      method: "POST",
      headers: { ...baseHeaders(), "x-org-id": input.endOrgId },
      body: JSON.stringify({}),
    });
    const json = (await res.json().catch(() => null)) as
      | { token?: string; data?: { token?: string }; error?: unknown; message?: string }
      | null;
    const token = json?.data?.token ?? json?.token;
    if (!res.ok || !token) {
      log.error("fastn embed token failed", { status: res.status, body: JSON.stringify(json)?.slice(0, 300) });
      return { error: `Could not open integrations (Fastn ${res.status}).` };
    }
    return { token };
  } catch (err) {
    log.error("fastn embed token crashed", { error: (err as Error).message });
    return { error: "Could not reach the integrations service. Try again in a moment." };
  }
}

export function embedIframeUrl(token: string) {
  return `${API_BASE}/v1/embed/iframe?token=${encodeURIComponent(token)}`;
}

/**
 * Queue an event for a restaurant and deliver it after the response is sent.
 * Never throws and never slows down the till: integrations are best-effort
 * from the POS's point of view, and the outbox keeps anything that failed.
 */
export function emitIntegrationEvent(
  restaurantId: string,
  type: IntegrationEventType,
  build: () => Promise<Record<string, unknown> | null>
) {
  const run = async () => {
    try {
      const settings = await prisma.integrationSettings.findUnique({ where: { restaurantId } });
      // Restaurants that never opened Integrations have nothing connected.
      if (!settings?.fastnEndOrgId || !settings.enabled) return;
      if (type === "order.paid" && !settings.sendCustomersToCrm) return;
      if (type === "shift.closed" && !settings.sendShiftReports) return;
      if (type === "khata.reminder" && !settings.sendKhataReminders) return;
      const data = await build();
      if (!data) return;
      const event = await prisma.integrationEvent.create({
        data: { restaurantId, type, payload: data as Prisma.InputJsonValue },
      });
      await deliverEvent(event.id);
    } catch (err) {
      log.error("integration event failed", { restaurantId, type, error: (err as Error).message });
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts, tests): just run it.
    void run();
  }
}

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one outbox event to its Fastn workflow, with up to three attempts and
 * exponential backoff. Only transient failures (network, 429, 5xx) retry.
 */
export async function deliverEvent(eventId: string) {
  const event = await prisma.integrationEvent.findUnique({
    where: { id: eventId },
    include: { restaurant: { select: { id: true, name: true, slug: true, currency: true, timeZone: true } } },
  });
  if (!event) return null;
  const settings = await getIntegrationSettings(event.restaurantId);
  const workflowId = workflowFor(event.type as IntegrationEventType);

  if (!settings.fastnEndOrgId || !workflowId || !apiKey()) {
    return prisma.integrationEvent.update({
      where: { id: event.id },
      data: { status: "SKIPPED", lastError: "Integrations are not configured for this restaurant." },
    });
  }

  const input = {
    event: event.type,
    eventId: event.id,
    occurredAt: event.createdAt.toISOString(),
    tenant: {
      restaurantId: event.restaurant.id,
      name: event.restaurant.name,
      slug: event.restaurant.slug,
      currency: event.restaurant.currency,
      timeZone: event.restaurant.timeZone,
    },
    settings: {
      bigOrderThreshold: settings.bigOrderThresholdCents / 100,
      slackChannel: settings.slackChannel,
      sheetName: settings.sheetName,
      ownerEmail: settings.ownerEmail,
    },
    data: event.payload,
  };

  let attempts = event.attempts;
  let lastError = "";
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts++;
    try {
      const res = await fastnFetch(`/workflows/${encodeURIComponent(workflowId)}/execute`, {
        method: "POST",
        headers: {
          ...baseHeaders(),
          "x-fastn-env": process.env.FASTN_ENV || "test",
          "x-end-org-id": settings.fastnEndOrgId,
          "x-end-org-ref": event.restaurant.slug,
        },
        body: JSON.stringify({ input }),
        cache: "no-store",
      });
      const text = await res.text();
      if (res.ok) {
        let executionId: string | null = null;
        try {
          const j = JSON.parse(text);
          executionId = j?.executionId ?? j?.data?.executionId ?? j?.id ?? j?.data?.id ?? null;
        } catch {
          /* inline workflow output, not JSON we need */
        }
        return prisma.integrationEvent.update({
          where: { id: event.id },
          data: { status: "SENT", attempts, sentAt: new Date(), lastError: null, executionId },
        });
      }
      lastError = `Fastn ${res.status}: ${text.slice(0, 280)}`;
      const transient = res.status === 429 || res.status >= 500;
      if (!transient) break;
    } catch (err) {
      lastError = (err as Error).message;
    }
    if (i < MAX_ATTEMPTS - 1) await sleep(500 * 4 ** i);
  }

  log.error("integration delivery failed", { eventId: event.id, type: event.type, error: lastError });
  return prisma.integrationEvent.update({
    where: { id: event.id },
    data: { status: "FAILED", attempts, lastError },
  });
}

/* ---------------------------------------------------------------------------
 * Payload builders. Kept here so every route that settles an order sends the
 * exact same shape to Fastn.
 * ------------------------------------------------------------------------- */

const money = (cents: number) => Math.round(cents) / 100;

export async function orderPayload(orderId: string) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { name: true, quantity: true, priceCents: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!o) return null;
  return {
    orderId: o.id,
    orderNumber: o.number,
    status: o.status,
    source: o.source,
    orderType: o.orderType,
    paymentMethod: o.paymentMethod,
    subtotal: money(o.subtotalCents),
    discount: money(o.discountCents),
    tax: money(o.taxCents),
    total: money(o.totalCents),
    refunded: money(o.refundedCents),
    paidAt: o.paidAt?.toISOString() ?? null,
    customer: o.customer
      ? { id: o.customer.id, name: o.customer.name, phone: o.customer.phone }
      : o.customerName || o.customerPhone
        ? { id: null, name: o.customerName, phone: o.customerPhone }
        : null,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, price: money(i.priceCents) })),
  };
}

export function emitOrderEvent(restaurantId: string, type: "order.paid" | "order.cancelled" | "order.refunded", orderId: string) {
  emitIntegrationEvent(restaurantId, type, () => orderPayload(orderId));
}

/**
 * Which Fastn customer a restaurant is. Stored on IntegrationSettings; the
 * FASTN_CUSTOMERS env map ({"<restaurant slug>":"<endOrgId>"}) seeds it so a
 * restaurant provisioned in the Fastn dashboard is picked up without a
 * database edit.
 */
export async function resolveEndOrgId(restaurantId: string, slug: string) {
  const settings = await getIntegrationSettings(restaurantId);
  if (settings.fastnEndOrgId) return settings.fastnEndOrgId;
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(process.env.FASTN_CUSTOMERS || "{}");
  } catch {
    log.warn("FASTN_CUSTOMERS is not valid JSON");
  }
  const fromEnv = map[slug] || map[restaurantId];
  if (!fromEnv) return null;
  await prisma.integrationSettings.update({ where: { restaurantId }, data: { fastnEndOrgId: fromEnv } });
  return fromEnv;
}

/** Customers with an open khata balance, as reminder events. */
export async function emitKhataReminders(restaurantId: string) {
  const { khataBalances } = await import("./khata");
  const balances = await khataBalances(restaurantId);
  const owing = [...balances.entries()].filter(([, b]) => b.balanceCents > 0);
  if (owing.length === 0) return 0;
  const customers = await prisma.customer.findMany({
    where: { restaurantId, id: { in: owing.map(([id]) => id) } },
    select: { id: true, name: true, phone: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));
  emitIntegrationEvent(restaurantId, "khata.reminder", async () => ({
    customers: owing
      .map(([id, b]) => ({ ...byId.get(id), balance: b.balanceCents / 100 }))
      .filter((c) => c.name),
    totalOutstanding: owing.reduce((s, [, b]) => s + b.balanceCents, 0) / 100,
  }));
  return owing.length;
}
