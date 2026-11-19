"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  apiQuantity,
  apiRequest,
  errorMessage,
  type Material,
  type SearchResponse,
  type SearchResult,
  useApiData,
} from "./exchange-api";
import { useOrganizationSession } from "./organization-session";

type SearchState =
  | { kind: "idle" | "loading" }
  | { kind: "error"; message: string }
  | ({ kind: "ready" } & SearchResponse);

function ResultCard({
  batch,
  supplierName,
}: {
  batch: SearchResult;
  supplierName: string;
}) {
  return (
    <article className="result-card">
      <div className="result-meta">
        <span className="tag">{batch.material.category}</span>
        <span className="batch-code">{batch.batchCode}</span>
      </div>
      <h3>{batch.material.name}</h3>
      <p className="supplier-name">
        Supplier · <strong>{supplierName}</strong>
      </p>
      <p className="result-description">
        {batch.description || "Description pending."}
      </p>
      <dl className="result-facts">
        <div>
          <dt>Available quantity</dt>
          <dd>
            {batch.availableQuantity} {batch.material.unit}
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{batch.location}</dd>
        </div>
      </dl>
      <div className="result-footer">
        <span className="match-score">
          {Math.round(batch.score * 100)}% match
        </span>
        <Link className="result-link" href={`/batches/${batch.batchId}`}>
          Open batch <span aria-hidden="true">↗</span>
          <span className="sr-only"> {batch.batchCode}</span>
        </Link>
      </div>
    </article>
  );
}

export function Discovery() {
  const session = useOrganizationSession();
  const catalog = useApiData<{ items: Material[] }>(
    session.organizationId ? "/api/materials" : null,
    session.organizationId,
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [minimum, setMinimum] = useState("");
  const [similarity, setSimilarity] = useState(20);
  const [results, setResults] = useState<SearchState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const materials = catalog.data?.items ?? [];
  const categories = [
    ...new Set(materials.map((material) => material.category)),
  ];
  const visibleMaterials = materials.filter(
    (material) => !category || material.category === category,
  );
  const selectedMaterial = materials.find(
    (material) => material.id === materialId,
  );
  const searching = results.kind === "loading";

  useEffect(() => () => controller.current?.abort(), []);
  // A new workspace must never display another organization's in-flight search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: organization changes intentionally reset the search.
  useEffect(() => {
    controller.current?.abort();
    setResults({ kind: "idle" });
  }, [session.organizationId]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session.organizationId) return;
    const term = query.trim();
    if (!term) {
      setResults({
        kind: "error",
        message: "Enter a material or use to search for.",
      });
      return;
    }
    const params = new URLSearchParams({
      q: term,
      minSimilarity: String(similarity / 100),
    });
    if (category) params.set("category", category);
    if (materialId) params.set("materialId", materialId);
    if (materialId && minimum.trim()) {
      try {
        params.set("minAvailableQuantity", apiQuantity(minimum));
      } catch (error) {
        setResults({ kind: "error", message: errorMessage(error) });
        return;
      }
    }

    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setResults({ kind: "loading" });
    try {
      const response = await apiRequest<SearchResponse>(
        `/api/search?${params}`,
        { signal: request.signal },
      );
      if (!request.signal.aborted) setResults({ kind: "ready", ...response });
    } catch (error) {
      if (!request.signal.aborted)
        setResults({ kind: "error", message: errorMessage(error) });
    }
  }

  function changeCategory(value: string) {
    setCategory(value);
    if (value && selectedMaterial?.category !== value) {
      setMaterialId("");
      setMinimum("");
    }
  }

  return (
    <>
      <section className="discovery-hero">
        <div>
          <p className="eyebrow">Consumer workspace · Material discovery</p>
          <h1>
            Good materials.
            <br />
            New possibilities.
          </h1>
          <p className="hero-copy">
            Source industrial byproducts for your next process. Find the right
            match, reserve your quantity, and connect with the supplier.
          </p>
        </div>
      </section>

      <form
        className="panel search-panel"
        onSubmit={search}
        aria-label="Material search"
      >
        <fieldset disabled={!session.organizationId || session.selecting}>
          <legend className="sr-only">Search and filter batches</legend>
          <label htmlFor="search-query">Search by material or use</label>
          <div className="search-row">
            <input
              id="search-query"
              type="search"
              placeholder="e.g. fly ash for cement blending"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={500}
              required
            />
            <button
              className="primary-button"
              type="submit"
              disabled={searching}
            >
              {searching ? "Searching…" : "Search batches"}
            </button>
          </div>
          <div className="filter-grid">
            <div>
              <label htmlFor="search-category">Category</label>
              <select
                id="search-category"
                value={category}
                disabled={!catalog.data}
                onChange={(event) => changeCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="search-material">Material</label>
              <select
                id="search-material"
                value={materialId}
                disabled={!catalog.data}
                onChange={(event) => {
                  setMaterialId(event.target.value);
                  setMinimum("");
                }}
              >
                <option value="">All materials</option>
                {visibleMaterials.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="minimum-quantity">
                Minimum quantity
                {selectedMaterial ? ` (${selectedMaterial.unit})` : ""}
              </label>
              <input
                id="minimum-quantity"
                inputMode="decimal"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                placeholder="Any quantity"
                aria-describedby="quantity-hint"
                disabled={!selectedMaterial}
              />
              <p className="field-hint" id="quantity-hint">
                {selectedMaterial
                  ? "Optional. Up to three decimal places."
                  : "Select a material to set a minimum."}
              </p>
            </div>
            <div className="similarity-filter">
              <label htmlFor="min-similarity">
                Minimum similarity <output>{similarity}%</output>
              </label>
              <input
                id="min-similarity"
                type="range"
                min="0"
                max="100"
                step="1"
                value={similarity}
                onChange={(event) => setSimilarity(Number(event.target.value))}
                aria-describedby="similarity-hint"
              />
              <p className="field-hint" id="similarity-hint">
                Higher values narrow the results.
              </p>
            </div>
          </div>
        </fieldset>
        {!session.organizationId && !session.loading ? (
          <p className="field-hint">Choose your organization to search.</p>
        ) : null}
        {catalog.loading ? (
          <output className="field-hint">Loading filters…</output>
        ) : null}
        {catalog.error ? (
          <div className="inline-error">
            <p role="alert">Filters are unavailable. {catalog.error}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={catalog.retry}
            >
              Retry filters
            </button>
          </div>
        ) : null}
        {results.kind === "error" ? (
          <p className="inline-error" role="alert">
            {results.message}
          </p>
        ) : null}
      </form>

      <section className="results" aria-labelledby="results-title">
        <div className="section-heading">
          <h2 id="results-title">Search results</h2>
        </div>
        {results.kind === "ready" ? (
          <output className="search-stats" aria-live="polite">
            {results.stats.matchedCount}{" "}
            {results.stats.matchedCount === 1 ? "result" : "results"} from{" "}
            {results.stats.searchedCount} eligible batches searched ·{" "}
            {(results.stats.elapsedMs / 1000).toFixed(3)} seconds ·{" "}
            {Math.round(results.stats.minSimilarity * 100)}% minimum similarity
            {results.items.length < results.stats.matchedCount
              ? ` · Showing the top ${results.items.length}`
              : ""}
          </output>
        ) : null}
        {results.kind === "idle" ? (
          <p className="empty-panel">
            Enter a search term to discover open batches.
          </p>
        ) : null}
        {searching ? (
          <output className="empty-panel">Searching the material index…</output>
        ) : null}
        {results.kind === "ready" && results.items.length === 0 ? (
          <p className="empty-panel">
            No batches match this search. Try a different term or remove a
            filter.
          </p>
        ) : null}
        {results.kind === "ready" && results.items.length > 0 ? (
          <div className="result-grid">
            {results.items.map((batch) => (
              <ResultCard
                key={batch.batchId}
                batch={batch}
                supplierName={
                  session.suppliers.find(
                    (item) => item.id === batch.supplierOrgId,
                  )?.name ?? `Organization ${batch.supplierOrgId}`
                }
              />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
