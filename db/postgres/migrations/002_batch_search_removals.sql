BEGIN;

CREATE TABLE IF NOT EXISTS batch_search_removals (
    batch_id bigint PRIMARY KEY CHECK (batch_id > 0),
    revision bigint NOT NULL CHECK (revision > 0)
);

-- Upgrade existing projections without losing the revision of closed batches.
INSERT INTO batch_search_removals (batch_id, revision)
SELECT batch_id, revision FROM batch_search WHERE status = 'CLOSED'
ON CONFLICT (batch_id) DO UPDATE SET
    revision = GREATEST(batch_search_removals.revision, EXCLUDED.revision);

DELETE FROM batch_search WHERE status = 'CLOSED';

COMMIT;
