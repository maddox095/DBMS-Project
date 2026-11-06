import type { NextRequest } from "next/server";
import { requireOrganizationId } from "@/server/demo-session";
import { json, respond } from "@/server/http";
import { searchBatches } from "@/server/search";

export function GET(request: NextRequest) {
  return respond(async () => {
    requireOrganizationId(request);
    return json({ items: await searchBatches(request.nextUrl.searchParams) });
  });
}
