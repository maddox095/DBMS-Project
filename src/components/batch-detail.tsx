"use client";

import Link from "next/link";
import { useState } from "react";
import { BatchExchange } from "./batch-exchange";
import { OrganizationPicker, useDemoSession } from "./demo-session";
import { type Batch, useApiData } from "./exchange-api";

export function BatchDetail({ batchId }: { batchId: string }) {
  const session = useDemoSession();
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

  return (
    <>
      <Link className="back-link" href="/">
        <span aria-hidden="true">←</span> Back to discovery
      </Link>
      <section className="discovery-hero detail-hero">
        <div>
          <p className="eyebrow">Batch details</p>
          <h1>{batch?.material.name ?? "Material batch"}</h1>
          <p className="hero-copy">
            Current batch information from the source database.
          </p>
        </div>
        <OrganizationPicker session={session} />
      </section>
      {notice?.organizationId === session.organizationId ? (
        <output className="panel success-notice">{notice.message}</output>
      ) : null}
      {resource.loading ? (
        <output className="empty-panel">Loading current batch details…</output>
      ) : null}
      {batch && session.organizationId && !session.selecting ? (
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
      {!session.organizationId && !session.loading ? (
        <p className="empty-panel">
          Choose a demo organization to view the batch.
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
      {batch ? (
        <article className="panel batch-detail">
          <div className="result-meta">
            <span className="tag">{batch.material.category}</span>
            <span className="batch-code">{batch.batchCode}</span>
          </div>
          <h2>Batch overview</h2>
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
    </>
  );
}
