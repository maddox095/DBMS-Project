import type { NextRequest } from "next/server";
import { editBatch, getBatch } from "@/server/batches";
import {
  currentOrganization,
  requireOrganizationRole,
} from "@/server/demo-session";
import { ApiError, json, respond } from "@/server/http";
import { readId } from "@/server/validation";

type BatchRoute = { params: Promise<{ batchId: string }> };

export function GET(request: NextRequest, { params }: BatchRoute) {
  return respond(async () => {
    const organization = await currentOrganization(request);
    const { batchId } = await params;
    const batch = await getBatch(readId(batchId, "batchId"));
    if (
      organization.role === "PRODUCER" &&
      batch.supplierOrgId !== organization.id
    )
      throw new ApiError(
        403,
        "BATCH_FORBIDDEN",
        "You can manage only your own inventory.",
      );
    if (
      organization.role === "CONSUMER" &&
      batch.supplierOrgId === organization.id
    )
      throw new ApiError(
        403,
        "SELF_RESERVATION",
        "You cannot source your own materials.",
      );
    return json(batch);
  });
}

export function PATCH(request: NextRequest, { params }: BatchRoute) {
  return respond(async () => {
    const supplierOrgId = await requireOrganizationRole(request, "PRODUCER");
    const { batchId } = await params;
    return json(
      await editBatch(request, readId(batchId, "batchId"), supplierOrgId),
    );
  });
}
