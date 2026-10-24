import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isErrorResponse } from "@/lib/staffApi";
import { deliverEvent } from "@/lib/fastn";
import { integrationsGuard } from "../../../_guard";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await integrationsGuard(req);
  if (isErrorResponse(session)) return session;
  const { id } = await params;
  // Scoped to the signed-in restaurant: one tenant can never replay another's event.
  const event = await prisma.integrationEvent.findFirst({ where: { id, restaurantId: session.restaurant.id } });
  if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });
  await prisma.integrationEvent.update({ where: { id }, data: { status: "PENDING" } });
  const result = await deliverEvent(id);
  return NextResponse.json({ ok: result?.status === "SENT", status: result?.status, error: result?.lastError ?? null });
}
