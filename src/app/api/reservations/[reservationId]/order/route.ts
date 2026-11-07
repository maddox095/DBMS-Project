import type { NextRequest } from "next/server";
import { requireOrganizationRole } from "@/server/demo-session";
import { json, readObject, respond } from "@/server/http";
import { deliveryKeys, readDelivery } from "@/server/order-details";
import { placeOrder } from "@/server/reservations";
import { readId } from "@/server/validation";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  return respond(async () => {
    const recipientOrgId = await requireOrganizationRole(request, "CONSUMER");
    const id = readId((await params).reservationId, "reservationId");
    const delivery = readDelivery(await readObject(request, deliveryKeys));
    const { order, created } = await placeOrder(id, recipientOrgId, delivery);
    return json(order, created ? 201 : 200);
  });
}
