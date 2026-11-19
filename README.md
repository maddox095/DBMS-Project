# Industrial Byproduct Exchange and Material Traceability

A DBMS course project for finding surplus industrial materials and tracing exchanges from source batches to recipients. MySQL is the authoritative store for batches, reservations, and orders. A Node.js worker copies batch snapshots to a rebuildable PostgreSQL search index.

The current setup includes material discovery and batch detail screens, the database schemas, the indexing worker, and APIs for semantic search and exchanges.

Follow the course demonstration to publish a batch, find it through semantic search, complete exchanges, and inspect the database records. [Course demonstration](docs/course-demo.md)

## Run the full stack with Docker Compose

Install Docker with the Compose plugin. Copy `.env.example` to `.env` using `Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` in a POSIX shell. If you already have an `.env`, add the four `MYSQL_*_PASSWORD` settings for the runtime accounts using `.env.example` as a reference. Each runtime password accepts 16–128 letters, digits, underscores, or hyphens. Use unique credentials outside the local demo.

```sh
docker compose up --build --detach --wait
docker compose ps
```

Open [http://localhost:3000](http://localhost:3000) and sign up or sign in. Producers land on inventory where they can publish batches and issue quotations. Consumers land on discovery where they can reserve materials, request quotations, and confirm orders. Both roles have an account page and order history scoped to their organization.

Compose starts the Next.js app, the indexing worker, MySQL, and PostgreSQL with pgvector. It waits for both schemas before starting the app and worker. The first semantic search and the first open-batch index event download the pinned embedding model into each service's persistent cache. App and database ports bind to loopback. Change `APP_PORT`, `MYSQL_PORT`, or `POSTGRES_PORT` in `.env` if the defaults are in use.

Use `docker compose logs app worker mysql postgres` to inspect startup and `docker compose down` to stop the stack while keeping its data and model caches.

### Run the app and worker on the host

With Node.js 22 or later, run `npm ci` and start the databases using `docker compose up -d mysql postgres`. Use `npm run dev` for the app and `npm run worker` in a second terminal. Both processes read the Compose settings in `.env`. Use the host port values for this setup.

### Upgrade existing database volumes

Fresh volumes run the migrations and provision the MySQL roles automatically. For volumes from an earlier checkout, back up both databases and stop the app and worker. Run `docker compose up -d mysql postgres` to mount the new migrations. A database can report unhealthy until its upgrade completes.

Connect as MySQL root with `docker compose exec mysql mysql -u root -p`. Select your database and run any pending SQL migrations in order. All six SQL files can be reapplied.

```sql
USE byproduct_exchange;
source /docker-entrypoint-initdb.d/001_initial_schema.sql
source /docker-entrypoint-initdb.d/002_demo_seed.sql
source /docker-entrypoint-initdb.d/003_order_fulfillment.sql
source /docker-entrypoint-initdb.d/004_organization_roles.sql
source /docker-entrypoint-initdb.d/005_authentication.sql
source /docker-entrypoint-initdb.d/006_exchange_rules.sql
```

Exit the MySQL shell and provision the runtime accounts. The script activates each account's role and applies the configured passwords.

```sh
docker compose exec mysql bash /docker-entrypoint-initdb.d/007_database_roles.sh
docker compose exec postgres psql -X -v ON_ERROR_STOP=1 -U exchange_search -d byproduct_search -f /docker-entrypoint-initdb.d/01-vector.sql -f /docker-entrypoint-initdb.d/02-batch-search.sql -f /docker-entrypoint-initdb.d/03-batch-search-removals.sql
docker compose up --build --detach --wait
```

The command examples use the database names and PostgreSQL user in `.env.example`. Existing organizations still need a user provisioned through the account-creation command if they have never received a login. The PostgreSQL upgrade removes existing closed-batch vectors and records their revisions.

The `batch_id` primary key keeps one vector per open MySQL batch and supports versioned upserts. The partial B-tree indexes on `material_id` and `category` help filter available batches before exact cosine ranking. The worker sets `indexed_at` when it replaces a snapshot.

Run the smoke test to check cosine scores, tie-breaking by batch ID, and exclusion of closed or depleted batches. The test uses temporary fixtures.

```powershell
Get-Content -Raw db/postgres/tests/search_schema.sql | docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U exchange_search -d byproduct_search
```

```sh
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U exchange_search -d byproduct_search < db/postgres/tests/search_schema.sql
```

## Try the batch APIs

Initialize MySQL including migration 005, then create an account. Public signup creates a new organization and its first user. It cannot attach to an existing organization, and email/company conflicts roll back the entire signup. The server checks the authenticated user's stored organization and role for every action. `GET /api/auth/session` exposes only the current user and organization; the former account-selection endpoint has been removed. Business mutations also require `X-Organization-Id` to match the authenticated membership, so an old tab cannot act as a different account. This header does not authenticate a user.

For the seeded organizations, provision users from a trusted local terminal. The command requires direct database access from `.env`, asks for a password twice with hidden entry, and never accepts a password argument or changes organization roles:

```powershell
npm run account:create -- --organization-id 1 --email supplier@example.com --name "Supplier Owner"
npm run account:create -- --organization-id 2 --email recipient@example.com --name "Recipient Owner"
npm run account:create -- --organization-id 3 --email cooperative@example.com --name "Cooperative Owner"
```

There are no default passwords or public claim links for these organizations. Existing records and orders are preserved. See [authentication behavior and deployment notes](docs/authentication.md).

```powershell
$api = "http://localhost:3000/api"
$supplierCredential = Get-Credential -Message "Producer account"
$login = @{ email = $supplierCredential.UserName; password = $supplierCredential.GetNetworkCredential().Password } | ConvertTo-Json
$supplier = Invoke-RestMethod "$api/auth/login" -Method Post -ContentType "application/json" -Body $login -SessionVariable supplierSession
$supplierHeaders = @{"X-Organization-Id" = $supplier.organization.id}
$materials = Invoke-RestMethod "$api/materials" -WebSession $supplierSession
$material = $materials.items | Where-Object name -eq "Fly ash"
$body = @{
    materialId = $material.id
    batchCode = "FLY-001"
    description = "Dry fly ash for cement blending."
    location = "Bengaluru"
    totalQuantity = "100.000"
} | ConvertTo-Json
$batch = Invoke-RestMethod "$api/batches" -Method Post -ContentType "application/json" -Body $body -Headers $supplierHeaders -WebSession $supplierSession
Invoke-RestMethod "$api/batches/$($batch.batchId)" -WebSession $supplierSession
```

`GET /api/batches` lists a producer's own batches, including closed batches (`status=OPEN|CLOSED|ALL`), or open batches for a consumer. It supports `materialId`, `afterId`, and `limit`. The supplier can edit or close a batch with `PATCH /api/batches/{batchId}`. Publish and edit commit the batch and its search event together. [Data model and API contract](docs/data-model-and-interfaces.md)

To reserve the batch and place an order, sign in as a Consumer in a separate authenticated session. Keep the same idempotency key when retrying the reservation request.

```powershell
$recipientCredential = Get-Credential -Message "Consumer account"
$login = @{ email = $recipientCredential.UserName; password = $recipientCredential.GetNetworkCredential().Password } | ConvertTo-Json
$recipientAccount = Invoke-RestMethod "$api/auth/login" -Method Post -ContentType "application/json" -Body $login -SessionVariable recipientSession
$recipientHeaders = @{"X-Organization-Id" = $recipientAccount.organization.id}
$requestKey = [guid]::NewGuid().ToString()
$reservation = Invoke-RestMethod "$api/batches/$($batch.batchId)/reservations" -Method Post -ContentType "application/json" -Body '{"quantity":"15.000"}' -Headers @{"Idempotency-Key" = $requestKey; "X-Organization-Id"=$recipientAccount.organization.id} -WebSession $recipientSession
$delivery = @{
    contactName = "Aarav Rao"; company = "Bengaluru Cement Lab"
    email = "procurement@example.com"; phone = "+91 90000 00000"
    addressLine = "24 Industrial Estate"; city = "Bengaluru"; region = "Karnataka"
    postalCode = "560001"; country = "India"; deliveryMethod = "DELIVERY"
    notes = "Call before delivery."
} | ConvertTo-Json
$order = Invoke-RestMethod "$api/reservations/$($reservation.reservationId)/order" -Method Post -ContentType "application/json" -Body $delivery -Headers $recipientHeaders -WebSession $recipientSession
$quotation = @{
    unitPrice = "12.34"; freight = "100.00"; taxPercent = "18"
    validUntil = (Get-Date).ToUniversalTime().AddDays(7).ToString("yyyy-MM-dd")
    terms = "Dispatch within three business days. Payment on delivery."
} | ConvertTo-Json
Invoke-RestMethod "$api/orders/$($order.orderId)/quotation" -Method Post -ContentType "application/json" -Body $quotation -Headers $supplierHeaders -WebSession $supplierSession
Invoke-RestMethod "$api/orders/$($order.orderId)/confirm" -Method Post -Headers $recipientHeaders -WebSession $recipientSession
```

Use `POST /api/reservations/{reservationId}/cancel` to release an active hold. Reservations and cancellations update available quantity and enqueue a search snapshot in the same transaction. Requesting the quotation converts the hold once and preserves the available quantity. Contact, address, company, tax reference, delivery preference, and notes are saved in `order_fulfillments`. The supplier issues an INR quotation; the recipient confirms it before its UTC expiry. Prices use exact decimal arithmetic and round half up to paise. Tax applies to the material subtotal plus freight. Quotations are shown in the application; email and shipping integrations are not configured. Existing orders remain readable with `fulfillment: null`. A repeated request returns the original order and does not overwrite its delivery snapshot.

After the exchange, retrieve the batch trace with the supplier session or a recipient session.

```powershell
Invoke-RestMethod "$api/batches/$($batch.batchId)/trace" -WebSession $supplierSession
Invoke-RestMethod "$api/batches/$($batch.batchId)/trace" -WebSession $recipientSession
```

The trace includes the source, distinct recipients, reservation quantities and states, and completed orders. The supplier sees all exchanges for the batch. Each recipient sees its own records.

## Inspect the indexing worker

The worker copies batch changes to the PostgreSQL search index. Publishing creates a vector, editing or changing availability updates it, and closing the batch deletes its vector. The worker records the close revision so stale events cannot recreate the vector.

Publish a batch through the API, then query `batch_search` in PostgreSQL to see the indexed revision and its 384-dimensional vector.

```sql
SELECT batch_id, revision, available_quantity, vector_dims(embedding)
FROM batch_search
ORDER BY batch_id;
```

The worker marks an event processed after PostgreSQL commits it. Equal or older revisions leave the current vector or deletion in place. Failed events stay pending in MySQL and retry with a delay of up to five minutes.

### Rebuild the search index

Pause batch writes and indexing with `docker compose stop app worker`, then run `docker compose run --rm worker node worker/rebuild.mjs`. For a host-run setup, stop both host processes and run `npm run rebuild-search`. The rebuild replaces open vectors and closed-batch revision markers in one PostgreSQL transaction.

After the command succeeds, restart the web app and worker. Pending outbox events can replay against the rebuilt rows, and newer events continue updating them.

## Try semantic search

Once the worker indexes a batch, search with an authenticated Consumer session. The query accepts up to 500 characters.

```powershell
Invoke-RestMethod "$api/search?q=cement%20blending&limit=5" -WebSession $recipientSession
```

Search ranks open batches with available stock by cosine similarity. `minSimilarity` accepts 0–1 (up to three decimal places), and the UI slider accepts 0–100%. The response includes `stats.searchedCount` (eligible indexed rows after catalog/quantity filters), `stats.matchedCount` (above threshold before limiting), `stats.elapsedMs` (server processing including embedding and query), and `stats.minSimilarity`. The small results caption shows these real values; it does not imply that live MySQL rows were scanned. The default limit is 20, with at most 50 results per request. Use `category` or `materialId` to filter the results. Use `materialId` together with `minAvailableQuantity` to compare quantities in the same unit. Batch details and reservations check current availability in MySQL.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router pages, layouts, and styles |
| `src/app/api/` | Authentication, catalog, exchange, and search routes |
| `src/components/` | Discovery, batch details, and authenticated session controls |
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

Run `npm run test:integration` with the app, worker, and both databases running. The test signs up and logs in as both roles, completes an exchange, closes the batch, verifies vector deletion and rejection of stale revisions, and checks that the exchange remains traceable. It retains the verification records.

Migration 004 assigns the seeded Deccan Thermal Works account to `PRODUCER` and the other seeded accounts to `CONSUMER`. Existing suppliers are backfilled as producers on the first application; repeat application preserves assignments. `GET /api/orders` scopes activity to the consumer recipient or the producer supplier. The consumer search excludes its own organization defensively. Migration 005 replaces the selector with email/password authentication. Signup cannot choose an existing organization ID or set an existing account's role.

Run `npm run test:auth` for authentication, session expiry and revocation, and signup and login controls. Run `npm run test:database` to verify active MySQL roles, database permission denials, routines, triggers, and the recursive report. All three suites use development databases. Set `TEST_APP_URL` when the app is on a non-default port, and match the database host and published port settings in `.env`. See the [course demonstration](docs/course-demo.md#rubric-demonstration) for SQL examples.
