BEGIN;

CREATE TEMP TABLE search_fixture (LIKE batch_search INCLUDING ALL);

INSERT INTO search_fixture (
    batch_id, supplier_org_id, material_id, material_name, category, unit,
    batch_code, description, location, status, available_quantity, revision, embedding
)
SELECT batch_id, 1, 3, 'Fly ash', 'Mineral residues', 'kg',
       'FA-' || batch_id, 'Dry fly ash', 'Bengaluru', status, quantity, 1,
       (ARRAY[first, second] || array_fill(0::real, ARRAY[382]))::vector(384)
FROM (VALUES
    (42, 'OPEN',   20.000, 1::real, 0::real),
    (41, 'OPEN',   40.000, 1,       0),
    (43, 'OPEN',   20.000, 0,       1),
    (44, 'CLOSED', 20.000, 1,       0),
    (45, 'OPEN',    0.000, 1,       0)
) AS fixtures(batch_id, status, quantity, first, second);

DO $$
DECLARE
    query_embedding vector(384) := (ARRAY[1::real] || array_fill(0::real, ARRAY[383]))::vector(384);
    ranked_ids bigint[];
    scores double precision[];
BEGIN
    SELECT array_agg(batch_id ORDER BY distance, batch_id),
           array_agg(1 - distance ORDER BY distance, batch_id)
    INTO ranked_ids, scores
    FROM (
        SELECT batch_id, embedding <=> query_embedding AS distance
        FROM search_fixture
        WHERE status = 'OPEN' AND available_quantity > 0 AND material_id = 3
    ) AS ranked;

    IF ranked_ids IS DISTINCT FROM ARRAY[41, 42, 43]::bigint[]
        OR scores IS DISTINCT FROM ARRAY[1, 1, 0]::double precision[] THEN
        RAISE EXCEPTION 'Unexpected search results. IDs %, scores %', ranked_ids, scores;
    END IF;
END
$$;

ROLLBACK;
