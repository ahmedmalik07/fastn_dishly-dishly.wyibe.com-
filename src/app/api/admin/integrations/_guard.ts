import { NextResponse } from "next/server";
import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { ADMIN_ROLES } from "@/lib/auth";
import { isSameOrigin } from "@/lib/security";

/** Owners and managers only, same-origin for anything that changes state. */
export async function integrationsGuard(req: Request, mutating = true) {
  const session = await requireStaff(ADMIN_ROLES);
  if (isErrorResponse(session)) return session;
  if (mutating && !isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  return session;
}
