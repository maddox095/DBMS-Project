import type { NextRequest } from "next/server";
import { listBatches, publishBatch } from "@/server/batches";
import {
  currentOrganization,
  requireOrganizationRole,
} from "@/server/demo-session";
import { json, respond } from "@/server/http";

export function GET(request: NextRequest) {
  return respond(async () => {
    const organization = await currentOrganization(request);
    return json(
      await listBatches(
        request.nextUrl.searchParams,
        organization.role === "PRODUCER" ? organization.id : undefined,
      ),
    );
  });
}

export function POST(request: NextRequest) {
  return respond(async () => {
    const supplierOrgId = await requireOrganizationRole(request, "PRODUCER");
    return json(await publishBatch(request, supplierOrgId), 201);
  });
}
