import type { NextRequest } from "next/server";
import { requireOrganizationRole } from "@/server/auth";
import { json, readObject, respond } from "@/server/http";
import { changeOrder, quotationKeys } from "@/server/order-details";
import { readId } from "@/server/validation";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  return respond(async () => {
    const organizationId = await requireOrganizationRole(request, "PRODUCER");
    const id = readId((await params).orderId, "orderId");
    return json(
      await changeOrder(
        id,
        organizationId,
        await readObject(request, quotationKeys),
      ),
    );
  });
}
