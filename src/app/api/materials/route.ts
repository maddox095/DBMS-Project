import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { requireOrganizationId } from "@/server/demo-session";
import { json, respond } from "@/server/http";
import { mysqlPool } from "@/server/mysql";
import { readText } from "@/server/validation";

interface MaterialRow extends RowDataPacket {
  id: string;
  name: string;
  category: string;
  unit: string;
}

export function GET(request: NextRequest) {
  return respond(async () => {
    requireOrganizationId(request);
    const categoryParam = request.nextUrl.searchParams.get("category");
    const category =
      categoryParam === null ? null : readText(categoryParam, "category", 80);
    const [items] = await mysqlPool().execute<MaterialRow[]>(
      `SELECT id, name, category, unit FROM materials
       ${category === null ? "" : "WHERE category = ?"}
       ORDER BY category, name, id`,
      category === null ? [] : [category],
    );
    return json({ items });
  });
}
