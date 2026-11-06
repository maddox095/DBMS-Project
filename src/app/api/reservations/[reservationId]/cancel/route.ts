import type { NextRequest } from "next/server";
import { requireOrganizationId } from "@/server/demo-session";
import { json, respond } from "@/server/http";
import { cancelReservation } from "@/server/reservations";
import { readId } from "@/server/validation";

export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  return respond(async () => {
    const recipientOrgId = requireOrganizationId(request);
    const id = readId((await params).reservationId, "reservationId");
    return json(await cancelReservation(id, recipientOrgId));
  });
}
