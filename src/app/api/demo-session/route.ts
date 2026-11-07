import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import {
  demoOrganizationId,
  requireDemoConfig,
  setDemoSession,
} from "@/server/demo-session";
import { ApiError, json, readObject, respond } from "@/server/http";
import { mysqlPool } from "@/server/mysql";
import { readId } from "@/server/validation";

interface OrganizationRow extends RowDataPacket {
  id: string;
  name: string;
  role: "CONSUMER" | "PRODUCER";
}

export function GET(request: NextRequest) {
  return respond(async () => {
    requireDemoConfig();
    const [organizations] = await mysqlPool().execute<OrganizationRow[]>(
      "SELECT id, name, role FROM organizations ORDER BY id",
    );
    return json({ organizations, organizationId: demoOrganizationId(request) });
  });
}

export function POST(request: NextRequest) {
  return respond(async () => {
    requireDemoConfig();
    const body = await readObject(request, ["organizationId"]);
    const organizationId = readId(body.organizationId, "organizationId");
    const [rows] = await mysqlPool().execute<OrganizationRow[]>(
      "SELECT id, name, role FROM organizations WHERE id = CAST(? AS SIGNED)",
      [organizationId],
    );
    if (!rows[0])
      throw new ApiError(
        404,
        "ORGANIZATION_NOT_FOUND",
        "Organization not found.",
      );
    const response = json({ organization: rows[0] });
    setDemoSession(request, response, organizationId);
    return response;
  });
}
