import { NextResponse } from "next/server";
import { isErrorResponse } from "@/lib/staffApi";
import { embedIframeUrl, mintEmbedToken, resolveEndOrgId } from "@/lib/fastn";
import { integrationsGuard } from "../_guard";

export const dynamic = "force-dynamic";

/**
 * Fresh, tenant-scoped widget URL for the signed-in restaurant. The token is
 * minted for THIS restaurant's Fastn customer only, so the widget can only
 * ever show and create this restaurant's connections.
 */
export async function GET(req: Request) {
  const session = await integrationsGuard(req, false);
  if (isErrorResponse(session)) return session;
  const endOrgId = await resolveEndOrgId(session.restaurant.id, session.restaurant.slug);
  if (!endOrgId) {
    return NextResponse.json(
      { error: "Integrations are being set up for your restaurant. Contact dish.ly support to activate them." },
      { status: 409 }
    );
  }
  const minted = await mintEmbedToken({
    endOrgId,
    userEmail: session.user.email ?? undefined,
    userName: session.user.name,
  });
  if ("error" in minted) return NextResponse.json({ error: minted.error }, { status: 502 });
  return NextResponse.json(
    { url: embedIframeUrl(minted.token), endOrgId },
    { headers: { "Cache-Control": "no-store" } }
  );
}
