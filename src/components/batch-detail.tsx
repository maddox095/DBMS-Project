"use client";

import Link from "next/link";
import { useState } from "react";
import { BatchExchange } from "./batch-exchange";
import { type Batch, useApiData } from "./exchange-api";
import { useOrganizationSession } from "./organization-session";

export function BatchDetail({
  batchId,
  mode = "CONSUMER",
}: {
  batchId: string;
  mode?: "CONSUMER" | "PRODUCER";
}) {
  const session = useOrganizationSession();
  const resource = useApiData<Batch>(
    session.organizationId
      ? `/api/batches/${encodeURIComponent(batchId)}`
      : null,
    session.organizationId,
  );
  const batch = resource.data;
  const [notice, setNotice] = useState<{
    organizationId: string;
    message: string;
  } | null>(null);

  const ownBatch = batch?.supplierOrgId === session.organizationId;
  const permitted = mode === "PRODUCER" ? ownBatch : !ownBatch;

  return (
    <>
      <Link
        className="back-link"
        href={mode === "PRODUCER" ? "/producer" : "/"}
      >
        <span aria-hidden="true">←</span>{" "}
        {mode === "PRODUCER" ? "Back to inventory" : "Back to discovery"}
      </Link>
      <section className="discovery-hero detail-hero">
        <div>
          <p className="eyebrow">
            {mode === "PRODUCER"
              ? "Producer workspace · Manage batch"
              : "Consumer workspace · Batch details"}
          </p>
          <h1>{batch?.material.name ?? "Material batch"}</h1>
          <p className="hero-copy">
            {mode === "PRODUCER"
              ? "Manage your stock and respond to buyer requests."
              : "Review availability, reserve materials, and arrange your order."}
          </p>
        </div>
      </section>
      {notice?.organizationId === session.organizationId ? (
        <output className="panel success-notice">{notice.message}</output>
      ) : null}
      {resource.loading ? (
        <output className="empty-panel">Loading current batch details…</output>
      ) : null}
      {batch ? (
        <article className="panel batch-detail">
          <div className="result-meta">
            <span className="tag">{batch.material.category}</span>
            <span className="batch-code">{batch.batchCode}</span>
          </div>
          <h2>Batch overview</h2>
          <p className="supplier-name">
            Supplied by{" "}
            <strong>
              {session.suppliers.find((item) => item.id === batch.supplierOrgId)
                ?.name ?? `Organization ${batch.supplierOrgId}`}
            </strong>
          </p>
          <p>{batch.description || "Description pending."}</p>
          <dl className="detail-facts">
            <div>
              <dt>Available</dt>
              <dd>
                {batch.availableQuantity} {batch.material.unit}
              </dd>
            </div>
            <div>
              <dt>Total quantity</dt>
              <dd>
                {batch.totalQuantity} {batch.material.unit}
              </dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{batch.location}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{batch.status === "OPEN" ? "Open" : "Closed"}</dd>
            </div>
          </dl>
        </article>
      ) : null}
      {batch && permitted && session.organizationId && !session.selecting ? (
        <BatchExchange
          key={session.organizationId}
          batch={batch}
          organizationId={session.organizationId}
          onChanged={(message) => {
            setNotice({
              organizationId: session.organizationId ?? "",
              message,
            });
            resource.retry();
          }}
        />
      ) : null}
      {batch && !permitted ? (
        <p className="empty-panel">
          {mode === "PRODUCER"
            ? "This batch belongs to another producer. You can manage only your own inventory."
            : "Your organization supplies this batch. You cannot reserve or order your own materials."}
        </p>
      ) : null}
      {!session.organizationId && !session.loading ? (
        <p className="empty-panel">
          Choose your organization to view the batch.
        </p>
      ) : null}
      {resource.error ? (
        <div className="panel inline-error">
          <p role="alert">{resource.error}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={resource.retry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </>
  );
}
