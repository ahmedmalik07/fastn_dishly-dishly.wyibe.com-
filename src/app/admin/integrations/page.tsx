import { redirect } from "next/navigation";
import { getStaffSession, ADMIN_ROLES } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fastnConfigured, getIntegrationSettings, resolveEndOrgId } from "@/lib/fastn";
import IntegrationsHub from "@/components/admin/IntegrationsHub";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = (await getStaffSession())!;
  if (!ADMIN_ROLES.includes(session.user.role)) redirect("/admin");
  const restaurantId = session.restaurant.id;
  const endOrgId = await resolveEndOrgId(restaurantId, session.restaurant.slug);
  const settings = await getIntegrationSettings(restaurantId);
  const events = await prisma.integrationEvent.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, type: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true, payload: true },
  });

  return (
    <IntegrationsHub
      restaurantName={session.restaurant.name}
      active={Boolean(endOrgId) && fastnConfigured()}
      tenantRef={endOrgId ? `${endOrgId.slice(0, 8)}…` : null}
      settings={{
        enabled: settings.enabled,
        bigOrderThresholdCents: settings.bigOrderThresholdCents,
        slackChannel: settings.slackChannel,
        sheetName: settings.sheetName,
        ownerEmail: settings.ownerEmail,
        sendCustomersToCrm: settings.sendCustomersToCrm,
        sendShiftReports: settings.sendShiftReports,
        sendKhataReminders: settings.sendKhataReminders,
      }}
      currency={session.restaurant.currency}
      events={events.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        attempts: e.attempts,
        lastError: e.lastError,
        createdAt: e.createdAt.toISOString(),
        summary: summarize(e.type, e.payload as Record<string, unknown>),
      }))}
    />
  );
}

function summarize(type: string, p: Record<string, unknown>): string {
  const cust = p.customer as { name?: string } | null | undefined;
  switch (type) {
    case "order.paid":
      return `${p.test ? "Test order" : `Order #${p.orderNumber}`} · ${p.total}${cust?.name ? ` · ${cust.name}` : ""}`;
    case "order.cancelled":
      return `Order #${p.orderNumber} cancelled`;
    case "order.refunded":
      return `Order #${p.orderNumber} refunded ${p.refunded}`;
    case "shift.closed":
      return `Z-report · ${p.orderCount} orders · sales ${p.sales}`;
    case "khata.reminder":
      return `${(p.customers as unknown[] | undefined)?.length ?? 0} customers · ${p.totalOutstanding} outstanding`;
    default:
      return type;
  }
}
