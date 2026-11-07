"use client";

import { type FormEvent, useRef, useState } from "react";
import { BatchForm } from "./batch-form";
import {
  apiRequest,
  type Batch,
  errorMessage,
  jsonOptions,
  positiveQuantity,
  type Reservation,
  type Trace,
  useApiData,
} from "./exchange-api";

export function BatchExchange({
  batch,
  organizationId,
  onChanged,
}: {
  batch: Batch;
  organizationId: string;
  onChanged: (message: string) => void;
}) {
  const trace = useApiData<Trace>(
    `/api/batches/${batch.batchId}/trace`,
    organizationId,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ quantity: string; key: string } | null>(null);
  const supplier = batch.supplierOrgId === organizationId;

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const quantity = positiveQuantity(String(fields.get("quantity") ?? ""));
      if (attempt.current?.quantity !== quantity)
        attempt.current = { quantity, key: crypto.randomUUID() };
      const options = jsonOptions("POST", { quantity });
      await apiRequest<Reservation>(
        `/api/batches/${batch.batchId}/reservations`,
        {
          ...options,
          headers: {
            ...options.headers,
            "Idempotency-Key": attempt.current.key,
          },
        },
      );
      attempt.current = null;
      onChanged("Reservation saved.");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "cancel" | "order") {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/reservations/${id}/${action}`, { method: "POST" });
      onChanged(
        action === "cancel" ? "Reservation cancelled." : "Order placed.",
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {supplier ? (
        <BatchForm
          batch={batch}
          organizationId={organizationId}
          onSaved={() => onChanged("Batch saved.")}
        />
      ) : (
        <form
          className="panel exchange-panel"
          onSubmit={reserve}
          aria-label="Reserve material"
        >
          <h2>Reserve material</h2>
          {batch.status === "OPEN" && batch.availableQuantity !== "0.000" ? (
            <fieldset disabled={busy} className="exchange-fields">
              <div>
                <label htmlFor="reserve-quantity">
                  Quantity ({batch.material.unit})
                </label>
                <input
                  id="reserve-quantity"
                  name="quantity"
                  inputMode="decimal"
                  required
                  aria-describedby="reserve-hint"
                />
                <p className="field-hint" id="reserve-hint">
                  Availability is checked when your request is submitted.
                </p>
              </div>
              <button className="primary-button" type="submit">
                {busy ? "Reserving…" : "Reserve quantity"}
              </button>
            </fieldset>
          ) : (
            <p className="muted">
              This batch is currently unavailable for new reservations.
            </p>
          )}
        </form>
      )}
      {error ? (
        <p className="panel inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="panel exchange-panel" aria-labelledby="history-title">
        <div className="section-heading">
          <h2 id="history-title">Exchange history</h2>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={trace.retry}
          >
            Refresh history
          </button>
        </div>
        {trace.loading ? (
          <output className="field-hint">Loading exchange history…</output>
        ) : null}
        {trace.errorStatus === 403 ? (
          <p className="muted">
            Your organization has no reservations for this batch yet.
          </p>
        ) : null}
        {trace.error && trace.errorStatus !== 403 ? (
          <p className="inline-error" role="alert">
            {trace.error}
          </p>
        ) : null}
        {trace.data ? (
          <>
            <p className="muted">Source · {trace.data.source.name}</p>
            {trace.data.reservations.length === 0 ? (
              <p className="muted">This batch has no reservations yet.</p>
            ) : null}
            <div className="history-list">
              {trace.data.reservations.map((reservation) => {
                const recipient = trace.data?.recipients.find(
                  (item) => item.id === reservation.recipientOrgId,
                );
                const order = trace.data?.orders.find(
                  (item) => item.reservationId === reservation.reservationId,
                );
                return (
                  <article
                    className="history-record"
                    key={reservation.reservationId}
                    aria-label={`Reservation ${reservation.reservationId}`}
                  >
                    <div className="section-heading">
                      <h3>{recipient?.name}</h3>
                      <span className="tag">
                        {reservation.status === "CONVERTED"
                          ? "Ordered"
                          : reservation.status === "CANCELLED"
                            ? "Cancelled"
                            : "Reserved"}
                      </span>
                    </div>
                    <p>
                      {reservation.quantity} {batch.material.unit} ·{" "}
                      <span className="batch-code">
                        Reservation {reservation.reservationId}
                      </span>
                    </p>
                    {order ? (
                      <p className="field-hint">
                        Order {order.orderId} ·{" "}
                        {new Date(order.placedAt).toLocaleString()}
                      </p>
                    ) : null}
                    {reservation.status === "ACTIVE" &&
                    reservation.recipientOrgId === organizationId ? (
                      <div className="button-row">
                        <button
                          className="primary-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(reservation.reservationId, "order")
                          }
                        >
                          Place order
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(reservation.reservationId, "cancel")
                          }
                        >
                          Cancel reservation
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
