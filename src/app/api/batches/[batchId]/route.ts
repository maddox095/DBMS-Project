import type { NextRequest } from "next/server";
import { editBatch, getBatch } from "@/server/batches";
import { requireOrganizationId } from "@/server/demo-session";
import { json, respond } from "@/server/http";
import { readId } from "@/server/validation";

type BatchRoute = { params: Promise<{ batchId: string }> };

export function GET(request: NextRequest, { params }: BatchRoute) {
  return respond(async () => {
    requireOrganizationId(request);
    const { batchId } = await params;
    return json(await getBatch(readId(batchId, "batchId")));
  });
}

export function PATCH(request: NextRequest, { params }: BatchRoute) {
  return respond(async () => {
    const supplierOrgId = requireOrganizationId(request);
    const { batchId } = await params;
    return json(
      await editBatch(request, readId(batchId, "batchId"), supplierOrgId),
    );
  });
}
