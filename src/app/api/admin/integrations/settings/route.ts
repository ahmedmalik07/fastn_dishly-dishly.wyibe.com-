import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isErrorResponse } from "@/lib/staffApi";
import { getIntegrationSettings } from "@/lib/fastn";
import { logAudit } from "@/lib/audit";
import { integrationsGuard } from "../_guard";

const schema = z.object({
  enabled: z.boolean().optional(),
  bigOrderThresholdCents: z.number().int().min(0).max(100_000_000).optional(),
  slackChannel: z.string().trim().min(2).max(80).optional(),
  sheetName: z.string().trim().min(1).max(100).optional(),
  ownerEmail: z.string().trim().email().max(200).nullable().optional(),
  sendCustomersToCrm: z.boolean().optional(),
  sendShiftReports: z.boolean().optional(),
  sendKhataReminders: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const session = await integrationsGuard(req);
  if (isErrorResponse(session)) return session;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the highlighted settings." }, { status: 400 });
  await getIntegrationSettings(session.restaurant.id);
  const updated = await prisma.integrationSettings.update({
    where: { restaurantId: session.restaurant.id },
    data: parsed.data,
  });
  await logAudit({
    restaurantId: session.restaurant.id,
    actorId: session.user.id,
    actorName: session.user.name,
    action: "settings.updated",
    detail: "Integration settings",
  });
  return NextResponse.json({ ok: true, settings: updated });
}
