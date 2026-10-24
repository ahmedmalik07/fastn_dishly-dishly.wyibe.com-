"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  enabled: boolean;
  bigOrderThresholdCents: number;
  slackChannel: string;
  sheetName: string;
  ownerEmail: string | null;
  sendCustomersToCrm: boolean;
  sendShiftReports: boolean;
  sendKhataReminders: boolean;
};

type EventRow = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  summary: string;
};

const RECIPES = [
  {
    app: "HubSpot",
    color: "#ff7a59",
    when: "Every paid order",
    what: "Creates or updates the guest as a contact with their visit and spend, so repeat diners show up in your CRM.",
  },
  {
    app: "Slack",
    color: "#4a154b",
    when: "Big orders, voids, refunds, shift close",
    what: "Alerts your manager channel the moment something needs attention.",
  },
  {
    app: "Google Sheets",
    color: "#0f9d58",
    when: "Shift close",
    what: "Appends the Z-report (sales, tax, cash vs card, variance) as one row for your accountant.",
  },
  {
    app: "Gmail",
    color: "#ea4335",
    when: "Shift close, nightly khata",
    what: "Emails the owner an end-of-day summary and sends khata payment reminders.",
  },
  {
    app: "Google Drive",
    color: "#1a73e8",
    when: "Shift close",
    what: "Saves each Z-report as a CSV in your Drive, one file per shift.",
  },
];

const EVENT_LABEL: Record<string, string> = {
  "order.paid": "Order paid",
  "order.cancelled": "Order voided",
  "order.refunded": "Refund",
  "shift.closed": "Shift closed",
  "khata.reminder": "Khata reminders",
  "test.ping": "Test",
};

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    SENT: "bg-emerald-100 text-emerald-800",
    FAILED: "bg-red-100 text-red-800",
    PENDING: "bg-amber-100 text-amber-800",
    SKIPPED: "bg-stone-100 text-stone-600",
  };
  const label: Record<string, string> = { SENT: "Delivered", FAILED: "Failed", PENDING: "Sending", SKIPPED: "Skipped" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[status] ?? "bg-stone-100"}`}>
      {label[status] ?? status}
    </span>
  );
}

export default function IntegrationsHub(props: {
  restaurantName: string;
  active: boolean;
  tenantRef: string | null;
  settings: Settings;
  currency: string;
  events: EventRow[];
}) {
  const router = useRouter();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [widgetLoaded, setWidgetLoaded] = useState(false);
  const [settings, setSettings] = useState(props.settings);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadWidget = useCallback(async () => {
    setWidgetError(null);
    setWidgetLoaded(false);
    try {
      const res = await fetch("/api/admin/integrations/token", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not open integrations.");
      setWidgetUrl(json.url);
    } catch (err) {
      setWidgetError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // Fetching the tenant token is the external sync this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (props.active) void loadWidget();
  }, [props.active, loadWidget]);

  // The widget tells the page when a session ends or an app is connected.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const type = typeof e.data === "string" ? e.data : e.data?.type;
      if (type === "fastn:session-expired") void loadWidget();
      if (typeof type === "string" && /connected|disconnected|connection/i.test(type)) router.refresh();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadWidget, router]);

  async function post(url: string, label: string, okText: (j: Record<string, unknown>) => string) {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || "Delivery failed. See sync history.");
      setNotice({ tone: "ok", text: okText(json) });
    } catch (err) {
      setNotice({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/integrations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, ownerEmail: settings.ownerEmail || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save.");
      setNotice({ tone: "ok", text: "Integration settings saved." });
    } catch (err) {
      setNotice({ tone: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const lastByType = new Map<string, EventRow>();
  for (const ev of props.events) if (!lastByType.has(ev.type)) lastByType.set(ev.type, ev);
  const delivered = props.events.filter((e) => e.status === "SENT").length;
  const failed = props.events.filter((e) => e.status === "FAILED").length;

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">dish.ly Connect</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">Integrations</h1>
          <p className="mt-1 max-w-xl text-sm text-stone-500">
            Connect the tools {props.restaurantName} already uses. Sales, guests and Z-reports flow there on their own.
            The accounts you connect belong to {props.restaurantName} only, no other restaurant on dish.ly can see or use them.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              props.active ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {props.active ? "● Active" : "● Not activated"}
          </span>
          {props.tenantRef && <span className="text-[11px] text-stone-400">Private workspace {props.tenantRef}</span>}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className={`rounded-xl px-4 py-3 text-sm ${
            notice.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* Recipes */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-stone-700">What happens once you connect</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPES.map((r) => (
            <div key={r.app} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                <p className="font-semibold text-stone-900">{r.app}</p>
              </div>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{r.when}</p>
              <p className="mt-1 text-sm text-stone-600">{r.what}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Embedded Fastn widget */}
      <section className="rounded-2xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-stone-900">Your connected apps</h2>
            <p className="text-xs text-stone-500">Click an app, sign in with your own account, done. Disconnect any time.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!props.active || busy !== null}
              onClick={() => post("/api/admin/integrations/test", "test", () => "Test order delivered. Check your connected apps.")}
              className="rounded-xl bg-stone-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:opacity-40"
            >
              {busy === "test" ? "Sending…" : "Send test order"}
            </button>
            <button
              type="button"
              disabled={!props.active || busy !== null}
              onClick={() =>
                post("/api/admin/integrations/khata-reminders", "khata", (j) =>
                  Number(j.customers) > 0 ? `Reminders queued for ${j.customers} customers.` : "No open khata balances right now."
                )
              }
              className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-40"
            >
              {busy === "khata" ? "Sending…" : "Send khata reminders"}
            </button>
          </div>
        </div>
        <div className="relative min-h-[560px] p-2">
          {!props.active && (
            <div className="flex min-h-[540px] flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="font-semibold text-stone-800">Integrations aren&apos;t switched on for this restaurant yet</p>
              <p className="max-w-sm text-sm text-stone-500">Ask dish.ly support to activate dish.ly Connect. It takes a minute.</p>
            </div>
          )}
          {props.active && widgetError && (
            <div className="flex min-h-[540px] flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-red-700">{widgetError}</p>
              <button type="button" onClick={loadWidget} className="rounded-xl border px-3 py-2 text-xs font-semibold">
                Try again
              </button>
            </div>
          )}
          {props.active && widgetUrl && !widgetError && (
            <>
              {!widgetLoaded && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-400">Loading your apps…</div>
              )}
              <iframe
                src={widgetUrl}
                title="Connect your apps"
                onLoad={() => setWidgetLoaded(true)}
                className="h-[720px] w-full rounded-xl"
                allow="clipboard-write"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </>
          )}
        </div>
      </section>

      {/* Settings: the configuration template every restaurant starts from */}
      <form onSubmit={saveSettings} className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold text-stone-900">Sync settings</h2>
        <p className="text-xs text-stone-500">Sensible defaults are already set. Change them only if you need to.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">Big order alert at ({props.currency})</span>
            <input
              type="number"
              min={0}
              value={settings.bigOrderThresholdCents / 100}
              onChange={(e) => setSettings({ ...settings, bigOrderThresholdCents: Math.round(Number(e.target.value || 0) * 100) })}
              className="w-full rounded-xl border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">Slack channel</span>
            <input
              value={settings.slackChannel}
              onChange={(e) => setSettings({ ...settings, slackChannel: e.target.value })}
              className="w-full rounded-xl border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">Google Sheet name</span>
            <input
              value={settings.sheetName}
              onChange={(e) => setSettings({ ...settings, sheetName: e.target.value })}
              className="w-full rounded-xl border border-stone-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-stone-700">Owner email for daily summary</span>
            <input
              type="email"
              value={settings.ownerEmail ?? ""}
              placeholder="owner@restaurant.pk"
              onChange={(e) => setSettings({ ...settings, ownerEmail: e.target.value })}
              className="w-full rounded-xl border border-stone-300 px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-700">
          {(
            [
              ["enabled", "Integrations on"],
              ["sendCustomersToCrm", "Send guests to CRM"],
              ["sendShiftReports", "Send Z-reports"],
              ["sendKhataReminders", "Nightly khata reminders"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                className="h-4 w-4 accent-orange-600"
              />
              {label}
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>

      {/* Sync history with retry */}
      <section className="rounded-2xl border border-stone-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-stone-900">Sync history</h2>
            <p className="text-xs text-stone-500">
              {delivered} delivered{failed > 0 ? ` · ${failed} failed` : ""} · failed deliveries retry 3 times, then wait for you here
            </p>
          </div>
          <button type="button" onClick={() => router.refresh()} className="text-xs font-semibold text-orange-700 hover:underline">
            Refresh
          </button>
        </div>
        {props.events.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-stone-400">Nothing synced yet. Ring up a sale or send a test order.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {props.events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">
                    {EVENT_LABEL[ev.type] ?? ev.type} <span className="font-normal text-stone-500">· {ev.summary}</span>
                  </p>
                  <p className="text-[11px] text-stone-400">
                    {new Date(ev.createdAt).toLocaleString()} · attempt {ev.attempts}
                    {ev.lastError ? ` · ${ev.lastError.slice(0, 120)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={ev.status} />
                  {(ev.status === "FAILED" || ev.status === "SKIPPED") && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => post(`/api/admin/integrations/events/${ev.id}/retry`, ev.id, () => "Delivered on retry.")}
                      className="rounded-lg border border-stone-300 px-2 py-1 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
                    >
                      {busy === ev.id ? "…" : "Retry"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
