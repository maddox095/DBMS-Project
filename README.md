# Industrial Byproduct Exchange and Material Traceability

A DBMS course project for finding surplus industrial materials and tracing exchanges from source batches to recipients. The planned application uses MySQL as the authoritative store for batches, reservations, and orders, and PostgreSQL with pgvector as a rebuildable search index. A separate Node.js worker will keep the search index in sync.

This initial setup includes a Next.js starter page and local database configuration. Database schemas, application workflows, semantic search, and the indexing worker are planned.

## Run the web app

Install Node.js 22 or later and npm. From the repository root, run:

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The starter page works without database services or environment variables.

## Start the local databases

Install Docker with the Compose plugin. Copy `.env.example` to `.env` using `Copy-Item .env.example .env` in PowerShell or `cp .env.example .env` in a POSIX shell. The example values are for local development. Change `MYSQL_PORT` or `POSTGRES_PORT` in `.env` if the defaults are occupied.

```sh
docker compose up -d
docker compose ps
```

MySQL listens on `127.0.0.1:3306` and PostgreSQL on `127.0.0.1:5432` by default. PostgreSQL enables the `vector` extension in the search database when it first initializes its volume. Use `docker compose down` to stop both services and keep their data.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router pages, layouts, and styles |
| `src/app/api/` | Future HTTP route handlers |
| `src/components/` | Shared UI components |
| `src/server/` | Future server-side services and database access |
| `public/` | Public static assets |
| `db/mysql/migrations/` | Future migrations for the operational database |
| `db/postgres/` | pgvector initialization and future search migrations |
| `worker/` | Future Node.js indexing worker |

## Checks

```sh
npm run lint
npm run typecheck
npm run build
```

The starter uses the Next.js App Router, TypeScript, Tailwind CSS, and Biome. The npm lockfile records dependency versions for repeatable installs.
