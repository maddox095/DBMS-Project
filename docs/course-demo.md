# Course demonstration

This walkthrough follows a batch from publication to two recipients. The demo uses the three seeded organizations and the Fly ash catalog entry.

## Start the application

Use Node.js 22 or later, npm, and Docker Compose. Run the commands from the repository root. Copy the example configuration once and choose free database ports in `.env`.

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d
docker compose ps
npm run build
npm start
```

In another terminal, start `npm run worker`. The first indexing event downloads the pinned MiniLM model from Hugging Face. Open `http://localhost:3000`.

Fresh volumes load the schemas and MySQL seed automatically. For existing volumes, follow the initialization instructions in the README before running the walkthrough. [Database setup](../README.md#start-the-local-databases)

## Follow one batch through an exchange

1. Open **Publish batch**. Choose **Deccan Thermal Works**, select **Fly ash (kg)**, and enter batch code `DEMO-FLY-001`, location `Bengaluru`, total quantity `100`, and description `Dry fly ash suitable for cement blending.`. Publish the batch and retain its detail URL.
2. Return to discovery. Choose **Bengaluru Cement Lab**, search for `fly ash for cement blending`, and open `DEMO-FLY-001`. If the worker is still downloading the model, submit the search again when indexing finishes.
3. Reserve `30` kg. In **Exchange history**, choose **Place order**. The reservation becomes **Ordered**, and current availability is `70.000 kg`.
4. Choose **Kaveri Materials Cooperative** on the same batch. Reserve `20` kg and place that order. This organization sees its own order.
5. Choose **Deccan Thermal Works**. The history shows both recipients and their completed orders. The overview shows `50.000 kg` available.
6. To demonstrate releasing a hold, choose **Bengaluru Cement Lab**, reserve `5` kg, and cancel that reservation. Availability returns to `50.000 kg`. An attempted reservation of `80` kg displays the availability conflict.
7. Return to the supplier and change the location to `Mysuru`. Save the batch, then refresh discovery after the worker processes the change.

Use a different batch code for a repeated walkthrough in the same database. A supplier's batch code identifies one source batch.

## Explain the database design

The ER diagram and full column and API contracts are in the design document. [ER diagram and interfaces](data-model-and-interfaces.md#mysql-model)

- MySQL stores organizations, material classifications, batches, reservations, orders, and the outbox. An order references one reservation, which identifies its batch, recipient, and quantity.
- Quantities use fixed decimal precision. Availability subtracts active and converted reservations from a batch total. A cancelled hold releases its quantity, and conversion preserves the quantity already held.
- Writers lock the batch before checking quantities. The reservation, batch revision, and outbox change commit together. Trace reads use a consistent snapshot so the reported quantities and exchange history agree.
- PostgreSQL stores a derived snapshot per batch and a 384-dimensional vector. The worker and search API use the same pinned model and input settings. The revision guard prevents an older event from overwriting a newer snapshot.

## Inspect the data

Connect to MySQL with `docker compose exec mysql mysql -u exchange -p byproduct_exchange`, using the configured credentials. This query shows the source batch and its current availability.

```sql
SELECT b.id, b.batch_code, b.total_quantity,
       b.total_quantity - COALESCE(SUM(
         CASE WHEN r.status IN ('ACTIVE', 'CONVERTED') THEN r.quantity ELSE 0 END
       ), 0) AS available_quantity
FROM batches b
LEFT JOIN reservations r ON r.batch_id = b.id
WHERE b.supplier_org_id = 1 AND b.batch_code = 'DEMO-FLY-001'
GROUP BY b.id;
```

Trace completed quantities to their recipient organizations.

```sql
SELECT b.batch_code, source.name AS supplier, recipient.name AS recipient,
       r.quantity, r.status, o.id AS order_id, o.placed_at
FROM batches b
JOIN organizations source ON source.id = b.supplier_org_id
JOIN reservations r ON r.batch_id = b.id
JOIN organizations recipient ON recipient.id = r.recipient_org_id
LEFT JOIN exchange_orders o ON o.reservation_id = r.id
WHERE b.supplier_org_id = 1 AND b.batch_code = 'DEMO-FLY-001'
ORDER BY r.id;
```

Check delivery of indexing events.

```sql
SELECT batch_id, batch_revision, attempts, processed_at
FROM batch_index_events
ORDER BY id;
```

Connect to PostgreSQL with `docker compose exec postgres psql -U exchange_search -d byproduct_search`. Inspect the matching snapshot and embedding dimension.

```sql
SELECT batch_id, batch_code, revision, available_quantity,
       vector_dims(embedding) AS dimensions
FROM batch_search
WHERE supplier_org_id = 1 AND batch_code = 'DEMO-FLY-001';
```

The following example ranks open batches against the stored demo vector. The web search API instead embeds the user's query text.

```sql
SELECT batch_id, material_name,
       1 - (embedding <=> (
         SELECT embedding FROM batch_search
         WHERE supplier_org_id = 1 AND batch_code = 'DEMO-FLY-001'
       )) AS similarity
FROM batch_search
WHERE status = 'OPEN' AND available_quantity > 0
ORDER BY similarity DESC, batch_id
LIMIT 20;
```

## Rebuild and resume

Stop the web app and worker, keep the databases running, and run `npm run rebuild-search`. Restart the web app and worker after it completes. The search projection is reconstructed from MySQL, including current availability and closed batch revisions.

## Verification record

Verified on 7 November 2026 with fresh MySQL 8.4.11 and PostgreSQL 17.11 databases, pgvector 0.8.7, the production Next.js 16.4.5 server, and Chrome. The rehearsal used native database engines in WSL and the Windows application server. Docker Compose configuration validation also passed.

| Check | Observed result |
| --- | --- |
| Clean dependency install | `npm ci` completed, followed by passing lint, typecheck, and production build |
| Fresh schema and seed | Three organizations, four materials, and an empty batch catalog before publication |
| Publication and discovery | The browser published the demo batch and found it through the live embedding worker and semantic search API |
| Exchanges and visibility | Two recipient orders were visible to the supplier, and each recipient saw its own history |
| Cancellation and conflict | Cancelling a 5 kg hold restored availability, and an 80 kg request displayed the availability conflict |
| SQL inspection | All five SQL examples executed against the rehearsal data, showing two completed orders and 50.000 kg available |
| Search recovery | Rebuilding after stopping the app and worker retained the current 50.000 kg projection |

The owner review follows this walkthrough, checks the SQL results, and confirms the supplier and recipient views. Both project owners review the completed demo.
