import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isErrorResponse } from "@/lib/staffApi";
import { deliverEvent, resolveEndOrgId } from "@/lib/fastn";
import { integrationsGuard } from "../_guard";

/** Sends a sample paid order through the same workflow a real sale uses. */
export async function POST(req: Request) {
  const session = await integrationsGuard(req);
  if (isErrorResponse(session)) return session;
  const endOrgId = await resolveEndOrgId(session.restaurant.id, session.restaurant.slug);
  if (!endOrgId) return NextResponse.json({ error: "Integrations are not active for this restaurant yet." }, { status: 409 });
  const event = await prisma.integrationEvent.create({
    data: {
      restaurantId: session.restaurant.id,
      type: "order.paid",
      payload: {
        test: true,
        orderId: `test-${Date.now()}`,
        orderNumber: 0,
        status: "PAID",
        source: "POS",
        orderType: "DINE_IN",
        paymentMethod: "CARD",
        subtotal: 2400,
        discount: 0,
        tax: 384,
        total: 2784,
        refunded: 0,
        paidAt: new Date().toISOString(),
        customer: { id: null, name: "Test Guest", phone: "+923000000000" },
        items: [{ name: "Chicken Karahi (half)", quantity: 1, price: 1800 }, { name: "Naan", quantity: 4, price: 150 }],
      },
    },
  });
  const result = await deliverEvent(event.id);
  return NextResponse.json({ ok: result?.status === "SENT", status: result?.status, error: result?.lastError ?? null });
}
