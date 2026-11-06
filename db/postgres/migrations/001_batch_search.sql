BEGIN;

CREATE TABLE IF NOT EXISTS batch_search (
    batch_id bigint PRIMARY KEY CHECK (batch_id > 0),
    supplier_org_id bigint NOT NULL CHECK (supplier_org_id > 0),
    material_id bigint NOT NULL CHECK (material_id > 0),
    material_name text NOT NULL,
    category text NOT NULL,
    unit text NOT NULL,
    batch_code text NOT NULL,
    description text NOT NULL,
    location text NOT NULL,
    status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
    available_quantity numeric(14,3) NOT NULL CHECK (
        available_quantity >= 0 AND available_quantity <> 'NaN'::numeric
    ),
    revision bigint NOT NULL CHECK (revision > 0),
    embedding vector(384) NOT NULL CHECK (vector_norm(embedding) > 0),
    indexed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_batch_search_material_id
    ON batch_search (material_id)
    WHERE status = 'OPEN' AND available_quantity > 0;

CREATE INDEX IF NOT EXISTS ix_batch_search_category
    ON batch_search (category)
    WHERE status = 'OPEN' AND available_quantity > 0;

COMMIT;
