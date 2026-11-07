"use client";

import Link from "next/link";
import { useState } from "react";
import { Discovery } from "./discovery";
import {
  type Batch,
  type Order,
  type Reservation,
  useApiData,
} from "./exchange-api";
import { OrderDetails } from "./order-forms";
import { useOrganizationSession, WorkspaceGate } from "./organization-session";

export function HomeWorkspace() {
  const session = useOrganizationSession();
  if (session.role === "PRODUCER")
    return (
      <WorkspaceGate requiredRole="PRODUCER">
        <ProducerDashboard />
      </WorkspaceGate>
    );
  return (
    <WorkspaceGate requiredRole="CONSUMER">
      <Discovery />
    </WorkspaceGate>
  );
}

export function ProducerDashboard() {
  const session = useOrganizationSession();
  const [page, setPage] = useState<string | null>(null);
  const [status, setStatus] = useState("OPEN");
  const inventory = useApiData<{ items: Batch[]; nextAfterId: string | null }>(
    `/api/batches?limit=20&status=${status}${page ? `&afterId=${page}` : ""}`,
    session.organizationId,
  );
  return (
    <>
      <section className="workspace-heading">
        <div>
          <p className="eyebrow">Producer workspace</p>
          <h1>Your material inventory.</h1>
          <p className="hero-copy">
            Manage the batches your organization supplies. Review incoming buyer
            requests and prepare quotations.
          </p>
        </div>
        <Link className="primary-button" href="/batches/new">
          Publish a batch
        </Link>
      </section>
      <div className="inventory-filters">
        <label htmlFor="inventory-status">Batch status</label>
        <select
          id="inventory-status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(null);
          }}
        >
          <option value="OPEN">Open batches</option>
          <option value="CLOSED">Closed batches</option>
          <option value="ALL">All batches</option>
        </select>
      </div>
      <div className="section-heading">
        <h2>My batches</h2>
        <div className="button-row">
          <Link className="secondary-button" href="/producer/orders">
            Incoming requests
          </Link>
          <button
            className="secondary-button"
            type="button"
            onClick={inventory.retry}
          >
            Refresh inventory
          </button>
        </div>
      </div>
      {inventory.loading ? (
        <output className="field-hint">Loading your inventory…</output>
      ) : null}
      {inventory.error ? (
        <p role="alert" className="inline-error">
          {inventory.error}
        </p>
      ) : null}
      {inventory.data?.items.length === 0 ? (
        <p className="empty-panel">
          You have no batches on this page. Publish your first batch to make it
          available to consumers.
        </p>
      ) : null}
      <div className="inventory-list">
        {inventory.data?.items.map((batch) => (
          <article className="panel inventory-row" key={batch.batchId}>
            <div>
              <span className="batch-code">{batch.batchCode}</span>
              <h3>{batch.material.name}</h3>
              <p className="muted">
                {batch.location} · {batch.material.category}
              </p>
            </div>
            <div>
              <p className="field-hint">Available / Total</p>
              <p>
                {batch.availableQuantity} / {batch.totalQuantity}{" "}
                {batch.material.unit}
              </p>
            </div>
            <span className="tag">
              {batch.status === "OPEN" ? "Open" : "Closed"}
            </span>
            <Link
              className="secondary-button"
              href={`/producer/batches/${batch.batchId}`}
            >
              Manage batch
            </Link>
          </article>
        ))}
      </div>
      <div className="button-row pagination">
        {page ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPage(null)}
          >
            First page
          </button>
        ) : null}
        {inventory.data?.nextAfterId ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPage(inventory.data?.nextAfterId ?? null)}
          >
            Next page
          </button>
        ) : null}
      </div>
    </>
  );
}

type Activity = {
  reservation: Reservation;
  batchCode: string;
  materialName: string;
  unit: string;
  partnerName: string;
  order: Order | null;
};

export function OrdersDashboard() {
  const session = useOrganizationSession();
  const producer = session.role === "PRODUCER";
  const activity = useApiData<{ items: Activity[] }>(
    "/api/orders",
    session.organizationId,
  );
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <section className="workspace-heading">
        <div>
          <p className="eyebrow">
            {producer ? "Producer" : "Consumer"} workspace
          </p>
          <h1>
            {producer ? "Incoming requests." : "Your reservations & orders."}
          </h1>
          <p className="hero-copy">
            {producer
              ? "Requests for your organization's material. Review delivery details and issue quotations to buyers."
              : "Track your reserved quantities, delivery requests, quotations, and confirmed orders."}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={activity.retry}
        >
          Refresh
        </button>
      </section>
      {notice ? (
        <output className="panel success-notice">{notice}</output>
      ) : null}
      {activity.loading ? (
        <output className="field-hint">Loading requests…</output>
      ) : null}
      {activity.error ? (
        <p className="inline-error" role="alert">
          {activity.error}
        </p>
      ) : null}
      {activity.data?.items.length === 0 ? (
        <p className="empty-panel">
          {producer
            ? "No buyers have reserved your materials yet."
            : "You have no reservations yet. Discover materials to get started."}
        </p>
      ) : null}
      <div className="activity-list">
        {activity.data?.items.map((item) => (
          <article
            className="panel activity-card"
            key={item.reservation.reservationId}
          >
            <div className="section-heading">
              <div>
                <p className="batch-code">{item.batchCode}</p>
                <h2>{item.materialName}</h2>
                <p className="muted">
                  {producer ? "Buyer" : "Supplier"} · {item.partnerName}
                </p>
              </div>
              <Link
                className="secondary-button"
                href={`${producer ? "/producer" : ""}/batches/${item.reservation.batchId}#reservation-${item.reservation.reservationId}`}
              >
                {producer ? "Manage batch" : "View reservation"}
              </Link>
            </div>
            <p>
              {item.reservation.quantity} {item.unit} ·{" "}
              {item.reservation.status === "ACTIVE"
                ? "Reserved"
                : item.reservation.status === "CANCELLED"
                  ? "Cancelled"
                  : item.order?.fulfillment?.status === "QUOTED"
                    ? "Quotation ready"
                    : item.order?.fulfillment?.status === "QUOTE_REQUESTED"
                      ? "Awaiting quotation"
                      : "Confirmed order"}
            </p>
            {item.order ? (
              <details className="order-disclosure">
                <summary>
                  {producer &&
                  item.order.fulfillment?.status === "QUOTE_REQUESTED"
                    ? "Review request & prepare quotation"
                    : item.order.fulfillment?.status === "QUOTED"
                      ? "Review quotation"
                      : "View order details"}
                </summary>
                <OrderDetails
                  order={item.order}
                  organizationId={session.organizationId ?? ""}
                  supplier={producer}
                  unit={item.unit}
                  onChanged={(message) => {
                    setNotice(message);
                    activity.retry();
                  }}
                />
              </details>
            ) : item.reservation.status === "ACTIVE" ? (
              <p className="field-hint">
                {producer
                  ? "The buyer has reserved this quantity and has not submitted delivery details yet."
                  : "Open this reservation to add order details or cancel your hold."}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
