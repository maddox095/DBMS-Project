# Industrial Byproduct Exchange and Material Traceability

A DBMS course project for finding surplus industrial materials and tracing exchanges from source batches to recipients. MySQL is the authoritative store for batches, reservations, and orders. A Node.js worker copies batch snapshots to a rebuildable PostgreSQL search index.

The current setup includes material discovery and batch detail screens, the database schemas, the indexing worker, and APIs for semantic search and exchanges.

Follow the course demonstration to publish a batch, find it through semantic search, complete exchanges, and inspect the database records. [Course demonstration](docs/course-demo.md)

## Run the web app

Install Node.js 22 or later and npm. From the repository root, run:

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With both databases and the indexing worker running, choose a demo organization, search by material or use, and open a batch to see its current availability.

Use **Publish batch** to add material for the selected organization. On batch details, the supplier can edit the batch, and recipients can reserve a quantity and manage their holds in **Exchange history**. The history shows completed orders and the source organization.

## Start the local databases

Install Docker with the Compose plugin. Copy `.env.example` to `.env` using `Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` in a POSIX shell. The example values are for local development. Change `MYSQL_PORT` or `POSTGRES_PORT` in `.env` if the defaults are occupied.

```sh
docker compose up -d
docker compose ps
```

To inspect database startup output, run `docker compose logs mysql postgres`.

MySQL listens on `127.0.0.1:3306` and PostgreSQL on `127.0.0.1:5432` by default. Use `docker compose down` to stop both services and keep their data.

### Initialize MySQL

On a fresh volume, MySQL runs the files in `db/mysql/migrations/` in filename order. The seed adds three demo organizations and four catalog materials for the exchange demo.

For an existing MySQL volume, run `docker compose up -d mysql` to pick up the migration mount. Connect with the user, database, and password from `.env`. The command below uses the example user and database and prompts for the password.

```sh
docker compose exec mysql mysql -u exchange -p byproduct_exchange
```

At the `mysql>` prompt, run the initial schema and seed in this order. Both files can be reapplied to the initialized database and preserve existing rows.

```sql
source /docker-entrypoint-initdb.d/001_initial_schema.sql
source /docker-entrypoint-initdb.d/002_demo_seed.sql
SHOW TABLES;
```

### Initialize PostgreSQL search

On a fresh volume, PostgreSQL enables the `vector` extension and creates `batch_search`. For an existing volume, recreate the service with `docker compose up -d postgres` to pick up the migration mount, then apply the SQL files. The command uses the example database user and name from `.env`. Both files can be reapplied with existing search rows in place.

```sh
docker compose exec postgres psql -X -v ON_ERROR_STOP=1 -U exchange_search -d byproduct_search -f /docker-entrypoint-initdb.d/01-vector.sql -f /docker-entrypoint-initdb.d/02-batch-search.sql
```

The `batch_id` primary key keeps one snapshot per MySQL batch and supports versioned upserts. The partial B-tree indexes on `material_id` and `category` help filter rows with `status = 'OPEN' AND available_quantity > 0` before exact cosine ranking. The worker will set `indexed_at` when it replaces a snapshot.

Run the smoke test to check cosine scores, tie-breaking by batch ID, and exclusion of closed or depleted batches. The test uses temporary fixtures.

```powershell
Get-Content -Raw db/postgres/tests/search_schema.sql | docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U exchange_search -d byproduct_search
```

```sh
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U exchange_search -d byproduct_search < db/postgres/tests/search_schema.sql
```

## Try the batch APIs

Initialize MySQL and set `DEMO_SESSION_SECRET` in `.env` before starting Next.js. The local demo lets you select a seeded organization. `GET /api/demo-session` lists the available organizations, and `POST /api/demo-session` sets the session cookie. The catalog and batch endpoints use that cookie.

```powershell
$api = "http://localhost:3000/api"
Invoke-RestMethod "$api/demo-session" -Method Post -ContentType "application/json" -Body '{"organizationId":"1"}' -SessionVariable demo
$materials = Invoke-RestMethod "$api/materials" -WebSession $demo
$material = $materials.items | Where-Object name -eq "Fly ash"
$body = @{
    materialId = $material.id
    batchCode = "DEMO-001"
    description = "Dry fly ash for cement blending."
    location = "Bengaluru"
    totalQuantity = "100.000"
} | ConvertTo-Json
$batch = Invoke-RestMethod "$api/batches" -Method Post -ContentType "application/json" -Body $body -WebSession $demo
Invoke-RestMethod "$api/batches/$($batch.batchId)" -WebSession $demo
```

`GET /api/batches` lists open batches and supports `materialId`, `afterId`, and `limit`. The supplier can edit or close a batch with `PATCH /api/batches/{batchId}`. Publish and edit commit the batch and its search event together. [Data model and API contract](docs/data-model-and-interfaces.md)

To reserve the batch and place an order, select a different organization in a separate demo session. Keep the same idempotency key when retrying the reservation request.

```powershell
Invoke-RestMethod "$api/demo-session" -Method Post -ContentType "application/json" -Body '{"organizationId":"2"}' -SessionVariable recipient
$requestKey = [guid]::NewGuid().ToString()
$reservation = Invoke-RestMethod "$api/batches/$($batch.batchId)/reservations" -Method Post -ContentType "application/json" -Body '{"quantity":"15.000"}' -Headers @{"Idempotency-Key" = $requestKey} -WebSession $recipient
Invoke-RestMethod "$api/reservations/$($reservation.reservationId)/order" -Method Post -WebSession $recipient
```

Use `POST /api/reservations/{reservationId}/cancel` to release an active hold. Reservations and cancellations update available quantity and enqueue a search snapshot in the same transaction. Placing the order converts the hold once and preserves the available quantity.

After the exchange, retrieve the batch trace with the supplier session or a recipient session.

```powershell
Invoke-RestMethod "$api/batches/$($batch.batchId)/trace" -WebSession $demo
Invoke-RestMethod "$api/batches/$($batch.batchId)/trace" -WebSession $recipient
```

The trace includes the source, distinct recipients, reservation quantities and states, and completed orders. The supplier sees all exchanges for the batch. Each recipient sees its own records.

## Run the indexing worker

Initialize both databases and run `npm run worker` in a separate terminal. The worker reads the MySQL and PostgreSQL connection settings from `.env`. The first event downloads the pinned MiniLM model, and subsequent events reuse the local cache.

Publish a batch through the API, then query `batch_search` in PostgreSQL to see the indexed revision and its 384-dimensional vector.

```sql
SELECT batch_id, revision, available_quantity, vector_dims(embedding)
FROM batch_search
ORDER BY batch_id;
```

The worker marks an event processed after PostgreSQL commits it. Equal or older revisions leave the stored snapshot in place. Failed events stay pending in MySQL and retry with a delay of up to five minutes.

### Rebuild the search index

Stop the web app and indexing worker so batch writes are paused. Keep both databases running, then run `npm run rebuild-search`. The command reads current batch snapshots from MySQL and replaces the PostgreSQL projection in one transaction. A failed rebuild rolls back the projection. Closed batches are included so their revisions still guard against older events.

After the command succeeds, restart the web app and worker. Pending outbox events can replay against the rebuilt rows, and newer events continue updating them.

## Try semantic search

Once the worker indexes a batch, search with a demo session. The query accepts up to 500 characters.

```powershell
Invoke-RestMethod "$api/search?q=cement%20blending&limit=5" -WebSession $demo
```

Search ranks open batches with available stock by cosine similarity. Use `category` or `materialId` to filter the results. Use `materialId` together with `minAvailableQuantity` to compare quantities in the same unit. Batch details and reservations check current availability in MySQL.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router pages, layouts, and styles |
| `src/app/api/` | Demo session, catalog, exchange, and search routes |
| `src/components/` | Discovery, batch details, and shared demo session controls |
| `src/server/` | Server-side services and database access |
| `public/` | Public static assets |
| `db/mysql/migrations/` | MySQL schema and demo seed |
| `db/postgres/` | pgvector initialization, search schema, and smoke test |
| `worker/` | Node.js outbox consumer and search projection writes |

## Checks

```sh
npm run lint
npm run typecheck
npm run build
```

The web app uses the Next.js App Router, TypeScript, Tailwind CSS, and Biome. The npm lockfile records dependency versions for repeatable installs.
