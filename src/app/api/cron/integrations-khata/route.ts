import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { emitKhataReminders } from "@/lib/fastn";

export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Nightly: every connected restaurant's open khata balances go to its own workflow. */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await prisma.integrationSettings.findMany({
    where: { enabled: true, sendKhataReminders: true, fastnEndOrgId: { not: null } },
    select: { restaurantId: true },
  });
  let customers = 0;
  for (const r of rows) customers += await emitKhataReminders(r.restaurantId);
  return NextResponse.json({ ok: true, restaurants: rows.length, customers });
}
