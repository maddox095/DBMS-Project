import type { NextRequest } from "next/server";
import { listBatches, publishBatch } from "@/server/batches";
import { requireOrganizationId } from "@/server/demo-session";
import { json, respond } from "@/server/http";

export function GET(request: NextRequest) {
  return respond(async () => {
    requireOrganizationId(request);
    return json(await listBatches(request.nextUrl.searchParams));
  });
}

export function POST(request: NextRequest) {
  return respond(async () => {
    const supplierOrgId = requireOrganizationId(request);
    return json(await publishBatch(request, supplierOrgId), 201);
  });
}
