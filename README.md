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

Open [http://localhost:3000](http://localhost:3000). With both databases and the indexing worker running, choose an account at `/account`. Consumers land on material discovery and can reserve and order. Producers land at `/producer`, where they manage only their own inventory and incoming requests.

The producer navigation contains **My inventory**, **Incoming requests**, and **Publish batch**. Consumer navigation contains **Discover materials** and **My reservations & orders**; it never shows publishing tools. Producers cannot reserve/order, and consumers cannot publish/edit stock. Producer detail pages use `/producer/batches/{id}` and consumer detail pages use `/batches/{id}`. Account changes happen on `/account`, not inside a material page. Add contact and delivery details after reserving, request a quotation, and confirm it once the supplier has issued pricing. The supplier sees the delivery request and can prepare its quotation in the same history.

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

At the `mysql>` prompt, run the initial schema and seed in this order. All four files can be reapplied to the initialized database and preserve existing rows. Existing installations need `003_order_fulfillment.sql` and `004_organization_roles.sql` before starting the updated application.

```sql
source /docker-entrypoint-initdb.d/001_initial_schema.sql
source /docker-entrypoint-initdb.d/002_demo_seed.sql
source /docker-entrypoint-initdb.d/003_order_fulfillment.sql
source /docker-entrypoint-initdb.d/004_organization_roles.sql
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

Initialize MySQL and set `DEMO_SESSION_SECRET` in `.env` before starting Next.js. The local demo lets you select a seeded organization. `GET /api/demo-session` lists the available organizations, and `POST /api/demo-session` sets the session cookie. The catalog and batch endpoints use that cookie. Roles come from MySQL, and cannot be set through this session endpoint. Every business mutation also requires `X-Organization-Id` to match the cookie identity; stale tabs receive `409 ACCOUNT_CHANGED`. This header binds the visible account to the action and does not replace session verification. The shared client session refreshes on account changes in other tabs and window focus.

```powershell
$api = "http://localhost:3000/api"
Invoke-RestMethod "$api/demo-session" -Method Post -ContentType "application/json" -Body '{"organizationId":"1"}' -SessionVariable demo
$materials = Invoke-RestMethod "$api/materials" -WebSession $demo
$material = $materials.items | Where-Object name -eq "Fly ash"
$body = @{
    materialId = $material.id
    batchCode = "FLY-001"
    description = "Dry fly ash for cement blending."
    location = "Bengaluru"
    totalQuantity = "100.000"
} | ConvertTo-Json
$batch = Invoke-RestMethod "$api/batches" -Method Post -ContentType "application/json" -Body $body -Headers @{"X-Organization-Id"="1"} -WebSession $demo
Invoke-RestMethod "$api/batches/$($batch.batchId)" -WebSession $demo
```

`GET /api/batches` lists a producer's own batches, including closed batches (`status=OPEN|CLOSED|ALL`), or open batches for a consumer. It supports `materialId`, `afterId`, and `limit`. The supplier can edit or close a batch with `PATCH /api/batches/{batchId}`. Publish and edit commit the batch and its search event together. [Data model and API contract](docs/data-model-and-interfaces.md)

To reserve the batch and place an order, select a different organization in a separate demo session. Keep the same idempotency key when retrying the reservation request.

```powershell
Invoke-RestMethod "$api/demo-session" -Method Post -ContentType "application/json" -Body '{"organizationId":"2"}' -SessionVariable recipient
$requestKey = [guid]::NewGuid().ToString()
$reservation = Invoke-RestMethod "$api/batches/$($batch.batchId)/reservations" -Method Post -ContentType "application/json" -Body '{"quantity":"15.000"}' -Headers @{"Idempotency-Key" = $requestKey; "X-Organization-Id"="2"} -WebSession $recipient
$delivery = @{
    contactName = "Aarav Rao"; company = "Bengaluru Cement Lab"
    email = "procurement@example.com"; phone = "+91 90000 00000"
    addressLine = "24 Industrial Estate"; city = "Bengaluru"; region = "Karnataka"
    postalCode = "560001"; country = "India"; deliveryMethod = "DELIVERY"
    notes = "Call before delivery."
} | ConvertTo-Json
$order = Invoke-RestMethod "$api/reservations/$($reservation.reservationId)/order" -Method Post -ContentType "application/json" -Body $delivery -Headers @{"X-Organization-Id"="2"} -WebSession $recipient
$quotation = @{
    unitPrice = "12.34"; freight = "100.00"; taxPercent = "18"
    validUntil = (Get-Date).ToUniversalTime().AddDays(7).ToString("yyyy-MM-dd")
    terms = "Dispatch within three business days. Payment on delivery."
} | ConvertTo-Json
Invoke-RestMethod "$api/orders/$($order.orderId)/quotation" -Method Post -ContentType "application/json" -Body $quotation -Headers @{"X-Organization-Id"="1"} -WebSession $demo
Invoke-RestMethod "$api/orders/$($order.orderId)/confirm" -Method Post -Headers @{"X-Organization-Id"="2"} -WebSession $recipient
```

Use `POST /api/reservations/{reservationId}/cancel` to release an active hold. Reservations and cancellations update available quantity and enqueue a search snapshot in the same transaction. Requesting the quotation converts the hold once and preserves the available quantity. Contact, address, company, tax reference, delivery preference, and notes are saved in `order_fulfillments`. The supplier issues an INR quotation; the recipient confirms it before its UTC expiry. Prices use exact decimal arithmetic and round half up to paise. Tax applies to the material subtotal plus freight. Quotations are shown in the application; email and shipping integrations are not configured. Existing orders remain readable with `fulfillment: null`. A repeated request returns the original order and does not overwrite its delivery snapshot.

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
Invoke-RestMethod "$api/search?q=cement%20blending&limit=5" -WebSession $recipient
```

Search ranks open batches with available stock by cosine similarity. `minSimilarity` accepts 0–1 (up to three decimal places), and the UI slider accepts 0–100%. The response includes `stats.searchedCount` (eligible indexed rows after catalog/quantity filters), `stats.matchedCount` (above threshold before limiting), `stats.elapsedMs` (server processing including embedding and query), and `stats.minSimilarity`. The small results caption shows these real values; it does not imply that live MySQL rows were scanned. The default limit is 20, with at most 50 results per request. Use `category` or `materialId` to filter the results. Use `materialId` together with `minAvailableQuantity` to compare quantities in the same unit. Batch details and reservations check current availability in MySQL.

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

Run `npm run test:integration` with the local app, worker, and both databases running. It creates a verification batch and closes it afterwards while retaining its exchange audit records. The checks cover threshold statistics, contact validation and trace permissions, quotation rounding, concurrent issue, and repeatable confirmation.

Migration 004 assigns the seeded Deccan Thermal Works account to `PRODUCER` and the other seeded accounts to `CONSUMER`. Existing suppliers are backfilled as producers on the first application; repeat application preserves assignments. `GET /api/orders` scopes activity to the consumer recipient or the producer supplier. The consumer search excludes its own organization defensively. This remains a local account selector; real authentication is required before deployment with actual customer information.
