import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { currentOrganization } from "@/server/auth";
import { json, respond } from "@/server/http";
import { mysqlPool } from "@/server/mysql";

export function GET(request: NextRequest) {
  return respond(async () => {
    const organization = await currentOrganization(request);
    const [items] = await mysqlPool(organization.role).execute<RowDataPacket[]>(
      "SELECT id, name FROM organizations WHERE role = 'PRODUCER' ORDER BY name, id",
    );
    return json({ items });
  });
}
