import { NextResponse } from "next/server";
import { isErrorResponse } from "@/lib/staffApi";
import { emitKhataReminders } from "@/lib/fastn";
import { integrationsGuard } from "../_guard";

export async function POST(req: Request) {
  const session = await integrationsGuard(req);
  if (isErrorResponse(session)) return session;
  const count = await emitKhataReminders(session.restaurant.id);
  return NextResponse.json({ ok: true, customers: count });
}
