import type { NextRequest } from "next/server";
import { requireOrganizationId } from "@/server/demo-session";
import { json, respond } from "@/server/http";
import { traceBatch } from "@/server/trace";
import { readId } from "@/server/validation";

export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  return respond(async () => {
    const organizationId = requireOrganizationId(request);
    const batchId = readId((await params).batchId, "batchId");
    return json(await traceBatch(batchId, organizationId));
  });
}
