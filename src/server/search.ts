import { embedText } from "./embedding.mjs";
import { ApiError, invalidInput } from "./http";
import { postgresPool } from "./postgres.mjs";
import { readId, readLimit, readQuantity, readText } from "./validation";

interface SearchResult {
  batchId: string;
  supplierOrgId: string;
  material: { id: string; name: string; category: string; unit: string };
  batchCode: string;
  description: string;
  location: string;
  status: "OPEN";
  availableQuantity: string;
  revision: string;
  score: number;
}

export async function searchBatches(params: URLSearchParams) {
  const query = readText(params.get("q"), "q", 500);
  const limit = readLimit(params.get("limit"));
  const materialId = params.get("materialId");
  const category = params.get("category");
  const minimum = params.get("minAvailableQuantity");
  const conditions = ["status = 'OPEN'", "available_quantity > 0"];
  const filters: string[] = [];

  if (materialId !== null) {
    filters.push(readId(materialId, "materialId"));
    conditions.push(`material_id = $${filters.length + 1}`);
  }
  if (category !== null) {
    filters.push(readText(category, "category", 80));
    conditions.push(`category = $${filters.length + 1}`);
  }
  if (minimum !== null) {
    if (materialId === null) {
      throw invalidInput("minAvailableQuantity requires materialId.");
    }
    filters.push(
      minimum === "0.000"
        ? minimum
        : readQuantity(minimum, "minAvailableQuantity"),
    );
    conditions.push(`available_quantity >= $${filters.length + 1}`);
  }

  try {
    const database = postgresPool();
    const values = [await embedText(query), ...filters, String(limit)];
    const { rows } = await database.query<SearchResult>(
      `SELECT batch_id::text AS "batchId", supplier_org_id::text AS "supplierOrgId",
              json_build_object('id', material_id::text, 'name', material_name,
                                'category', category, 'unit', unit) AS material,
              batch_code AS "batchCode", description, location, status,
              available_quantity::text AS "availableQuantity", revision::text AS revision,
              1 - (embedding <=> $1::vector) AS score
       FROM batch_search
       WHERE ${conditions.join(" AND ")}
       ORDER BY embedding <=> $1::vector, batch_id
       LIMIT $${values.length}`,
      values,
    );
    return rows;
  } catch (error) {
    console.error("Semantic search failed:", error);
    throw new ApiError(
      503,
      "SEARCH_UNAVAILABLE",
      "Semantic search is temporarily unavailable.",
    );
  }
}
