import type { NextRequest } from "next/server";
import { requireOrganizationRole } from "@/server/demo-session";
import { json, respond } from "@/server/http";
import { searchBatches } from "@/server/search";

export function GET(request: NextRequest) {
  return respond(async () => {
    const organizationId = await requireOrganizationRole(request, "CONSUMER");
    return json(
      await searchBatches(request.nextUrl.searchParams, organizationId),
    );
  });
}
