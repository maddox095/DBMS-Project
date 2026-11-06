import type { NextRequest } from "next/server";
import { requireOrganizationId } from "@/server/demo-session";
import { json, readObject, respond } from "@/server/http";
import { readRequestKey, reserveBatch } from "@/server/reservations";
import { readId, readQuantity } from "@/server/validation";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  return respond(async () => {
    const recipientOrgId = requireOrganizationId(request);
    const batchId = readId((await params).batchId, "batchId");
    const key = readRequestKey(request);
    const body = await readObject(request, ["quantity"]);
    const { reservation, created } = await reserveBatch(
      batchId,
      recipientOrgId,
      key,
      readQuantity(body.quantity, "quantity"),
    );
    return json(reservation, created ? 201 : 200);
  });
}
