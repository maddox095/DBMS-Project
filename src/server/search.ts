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

export async function searchBatches(
  params: URLSearchParams,
  organizationId: string,
) {
  const started = performance.now();
  const query = readText(params.get("q"), "q", 500);
  const limit = readLimit(params.get("limit"));
  const materialId = params.get("materialId");
  const category = params.get("category");
  const minimum = params.get("minAvailableQuantity");
  const rawSimilarity = params.get("minSimilarity") ?? "0";
  const minSimilarity = Number(rawSimilarity);
  if (!/^(?:0(?:\.[0-9]{1,3})?|1(?:\.0{1,3})?)$/.test(rawSimilarity)) {
    throw invalidInput("minSimilarity must be a number from 0 to 1.");
  }
  const conditions = ["status = 'OPEN'", "available_quantity > 0"];
  const filters: string[] = [organizationId];
  conditions.push("supplier_org_id <> $2");

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
    const values = [await embedText(query), ...filters, minSimilarity, limit];
    const { rows } = await database.query<{
      items: SearchResult[];
      searchedCount: number;
      matchedCount: number;
    }>(
      `WITH eligible AS MATERIALIZED (
       SELECT batch_id::text AS "batchId", supplier_org_id::text AS "supplierOrgId",
              json_build_object('id', material_id::text, 'name', material_name,
                                'category', category, 'unit', unit) AS material,
              batch_code AS "batchCode", description, location, status,
              available_quantity::text AS "availableQuantity", revision::text AS revision,
              1 - (embedding <=> $1::vector) AS score
       FROM batch_search
       WHERE ${conditions.join(" AND ")}
       ), matches AS (
         SELECT * FROM eligible WHERE score >= $${values.length - 1}
       ), top_results AS (
         SELECT * FROM matches ORDER BY score DESC, "batchId"::bigint
         LIMIT $${values.length}
       )
       SELECT COALESCE((SELECT json_agg(t ORDER BY score DESC, "batchId"::bigint)
                       FROM top_results t), '[]'::json) AS items,
              (SELECT count(*)::int FROM eligible) AS "searchedCount",
              (SELECT count(*)::int FROM matches) AS "matchedCount"`,
      values,
    );
    return {
      items: rows[0].items,
      stats: {
        searchedCount: rows[0].searchedCount,
        matchedCount: rows[0].matchedCount,
        elapsedMs: Math.round((performance.now() - started) * 10) / 10,
        minSimilarity,
      },
    };
  } catch (error) {
    console.error("Semantic search failed:", error);
    throw new ApiError(
      503,
      "SEARCH_UNAVAILABLE",
      "Semantic search is temporarily unavailable.",
    );
  }
}
