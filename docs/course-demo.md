# Course demonstration

This walkthrough follows a batch from publication to two recipients. The demo uses the three seeded organizations and the Fly ash catalog entry.

## Start the application

Use Docker Compose from the repository root. Copy the example configuration once and choose free app and database ports in `.env`.

```powershell
Copy-Item .env.example .env
docker compose up --build --detach --wait
docker compose ps
```

Open `http://localhost:3000`. The first index event and semantic search download the pinned MiniLM model.

Fresh volumes load both schemas, the MySQL seed, and database roles automatically. Follow the upgrade instructions for existing volumes. [Database setup](../README.md#upgrade-existing-database-volumes)

## Create protected rehearsal accounts

The seeded organizations have no default credentials. With host Node.js 22 or later and `npm ci` complete, use the trusted local `npm run account:create` command documented in the README to create a user for organization 1 (Producer) and organizations 2 and 3 (Consumers). Choose private passwords interactively. Alternatively, sign up with new, distinct organization names and substitute them throughout this walkthrough.

Each change of organization below means **Sign out**, then **Sign in** with that organization's own user email and password. The account page does not allow organization switching or claiming seeded records.

## Follow one batch through an exchange

1. Sign in as the provisioned **Deccan Thermal Works** Producer user. Open **Publish batch**, select **Fly ash (kg)**, and enter batch code `FLY-001`, location `Bengaluru`, total quantity `100`, and description `Dry fly ash suitable for cement blending.`. Publish the batch and retain its detail URL.
2. Sign out and sign in as the **Bengaluru Cement Lab** Consumer user, continue to discovery, search for `fly ash for cement blending`, and open `FLY-001`. If the worker is still downloading the model, submit the search again when indexing finishes.
3. Reserve `30` kg. Complete the contact and delivery form and choose **Request quotation**. Use a fictional email at `example.com` for rehearsal data. Sign out and sign in as **Deccan Thermal Works** and open **Incoming requests**. Issue the quotation with unit price, freight, tax, a future validity date, and payment/delivery terms. Sign out and sign in as **Bengaluru Cement Lab**, review the total, and choose **Accept quotation & confirm order**. Current availability is `70.000 kg`.
4. Sign out and sign in as **Kaveri Materials Cooperative** and reopen the consumer batch URL. Reserve `20` kg, add delivery details, then repeat the supplier quotation and buyer confirmation steps. This organization sees its own order.
5. Sign out and sign in as **Deccan Thermal Works** and open **Incoming requests**. The history shows both recipients and their completed orders. The overview shows `50.000 kg` available.
6. To demonstrate releasing a hold, sign in as **Bengaluru Cement Lab**, reserve `5` kg, and cancel that reservation. Availability returns to `50.000 kg`. An attempted reservation of `80` kg displays the availability conflict.
7. Return to the supplier and change the location to `Mysuru`. Save the batch, then refresh discovery after the worker processes the change.

Use a different batch code for a repeated walkthrough in the same database. A supplier's batch code identifies one source batch.

## Explain the database design

The ER diagram and full column and API contracts are in the design document. [ER diagram and interfaces](data-model-and-interfaces.md#mysql-model)

- MySQL stores organizations, material classifications, batches, reservations, orders, and the outbox. An order references one reservation, which identifies its batch, recipient, and quantity.
- Quantities use fixed decimal precision. Availability subtracts active and converted reservations from a batch total. A cancelled hold releases its quantity, and conversion preserves the quantity already held.
- Writers lock the batch before checking quantities. The reservation, batch revision, and outbox change commit together. Trace reads use a consistent snapshot so the reported quantities and exchange history agree.
- PostgreSQL stores a derived snapshot and a 384-dimensional vector for each open batch. Closing the batch removes its vector and records the revision to protect against stale events.

## Inspect the data

Connect to MySQL with `docker compose exec mysql mysql -u exchange -p byproduct_exchange`, using the configured credentials. This query shows the source batch and its current availability.

```sql
SELECT b.id, b.batch_code, b.total_quantity,
       b.total_quantity - COALESCE(SUM(
         CASE WHEN r.status IN ('ACTIVE', 'CONVERTED') THEN r.quantity ELSE 0 END
       ), 0) AS available_quantity
FROM batches b
LEFT JOIN reservations r ON r.batch_id = b.id
WHERE b.supplier_org_id = 1 AND b.batch_code = 'FLY-001'
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
WHERE b.supplier_org_id = 1 AND b.batch_code = 'FLY-001'
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
WHERE supplier_org_id = 1 AND batch_code = 'FLY-001';
```

The following example ranks open batches against the stored demo vector. The web search API instead embeds the user's query text.

```sql
SELECT batch_id, material_name,
       1 - (embedding <=> (
         SELECT embedding FROM batch_search
         WHERE supplier_org_id = 1 AND batch_code = 'FLY-001'
       )) AS similarity
FROM batch_search
WHERE status = 'OPEN' AND available_quantity > 0
ORDER BY similarity DESC, batch_id
LIMIT 20;
```

## Rebuild and resume

Pause the app and worker with `docker compose stop app worker`, run `docker compose run --rm worker node worker/rebuild.mjs`, then resume with `docker compose up -d`. The rebuild uses MySQL to restore open vectors and closed-batch revision markers.

## Rubric demonstration

1. In the MySQL schema administrator session, run `source /opt/exchange-sql/catalog_dml.sql` to show insert, select, update, and delete using a disposable catalog row.
2. Run `source /opt/exchange-sql/weekly_confirmations.sql` after confirming an order. The recursive CTE generates seven calendar dates. The left join includes days with zero orders. Run `SELECT id, allocated_batch_quantity(id) AS allocated_kg FROM batches WHERE batch_code = 'FLY-001';` to show the stored function against the exchange data.
3. Show `SHOW TRIGGERS;` in MySQL. The batch triggers validate the supplier role, prevent reopening, and reject reducing stock below allocated quantity. The reservation triggers validate the consumer role and prevent changes to terminal states. Confirming a quotation in the app runs `confirm_recipient_order`. Issuing one runs `record_supplier_quote`.
4. Connect with `docker compose exec mysql mysql -u exchange_consumer -p byproduct_exchange` using `MYSQL_CONSUMER_PASSWORD`. Show `SELECT CURRENT_ROLE();` and execute `UPDATE batches SET status = 'CLOSED' WHERE 1 = 0;`. MySQL rejects the statement at the column permission check. A producer connection can issue quotations but MySQL denies its attempt to call `confirm_recipient_order`. See the [permission rules](authentication.md#mysql-authorization) for the account matrix.
5. Before closing the batch, record its ID and query `SELECT batch_id, revision, vector_dims(embedding) FROM batch_search WHERE batch_id = YOUR_BATCH_ID;`. Edit the batch and wait for the revision to increase. Close it as the producer and wait for the worker. The same query returns zero rows. `SELECT batch_id, revision FROM batch_search_removals WHERE batch_id = YOUR_BATCH_ID;` shows the deletion revision. The producer's MySQL trace still shows the confirmed exchange.

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

## Search and fulfillment update

The discovery screen now shows a small greyscale caption with exact eligible/matching index counts, server elapsed time, and the applied similarity threshold. Set the similarity slider to 100% and retry a broad query to inspect an empty result, then lower it to broaden the search. The slider filters before the result limit.

Migration `003_order_fulfillment.sql` adds persisted contact/delivery snapshots and supplier quotations. The revised walkthrough above replaces the earlier one-click order conversion. The original verification record describes the initial project; the update was additionally verified with live MySQL/PostgreSQL HTTP checks for search statistics, threshold validation, delivery validation/persistence, permission scope, exact quote totals, concurrent issue and confirmation replay.

Roles are fixed per account. Verify that consumers have no publish/edit navigation, producers have no discovery/reserve/order tools, and direct visits to the opposite workspace show a role gate. The integration test sends forbidden API requests directly and checks that self-reservations, cross-role writes, and stale-account headers fail.

### Compose and authorization verification

On 19 November 2026, the app and worker built and ran with MySQL 8.4.11 and PostgreSQL 17 with pgvector in an isolated Compose project.

| Check | Observed result |
| --- | --- |
| Authentication suite | Signup, password login, logout, session rotation and expiry, cross-origin rejection, and role isolation passed. |
| Exchange suite | Both roles signed in. The producer published a batch, and a consumer found it, reserved stock, requested a quotation, confirmed it, and cancelled a separate hold. The vector was created and updated. Closing removed it, rejected stale and equal revisions, and preserved the confirmed exchange in the trace. |
| MySQL suite | Each runtime connection activated its assigned role. MySQL denied cross-role statements, and the routine and trigger checks passed. The recursive report returned seven consecutive dates. |
| Database scripts | The catalog DML demo returned zero rows after the delete. The pgvector smoke test passed, and reapplying the upgrade retained the deletion revision for a legacy closed batch. The documented Compose rebuild restored the vectors and removal markers with the matching MySQL revisions. |
| Chrome walkthrough | The browser completed signup, logout, password login, publishing, search, a reservation, a delivery request, a quotation, order confirmation, viewing the producer trace, and closing the batch. |
