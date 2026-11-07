"use client";

import { type FormEvent, useState } from "react";
import {
  apiRequest,
  errorMessage,
  type Fulfillment,
  jsonOptions,
  type Order,
} from "./exchange-api";

const deliveryFields = [
  ["contactName", "Contact person", "text", 120, "name"],
  ["company", "Company name", "text", 160, "organization"],
  ["email", "Email address", "email", 254, "email"],
  ["phone", "Phone number", "tel", 32, "tel"],
  ["addressLine", "Street address", "text", 300, "street-address"],
  ["city", "City", "text", 100, "address-level2"],
  ["region", "State / region", "text", 100, "address-level1"],
  ["postalCode", "Postal code", "text", 20, "postal-code"],
  ["country", "Country", "text", 80, "country-name"],
] as const;

export function DeliveryForm({
  reservationId,
  organizationId,
  company,
  onSaved,
  onCancel,
}: {
  reservationId: string;
  organizationId: string;
  company: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const details = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await apiRequest(
        `/api/reservations/${reservationId}/order`,
        jsonOptions("POST", details, organizationId),
      );
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="order-form"
      onSubmit={submit}
      aria-label="Delivery and contact details"
    >
      <div>
        <p className="eyebrow">Next step</p>
        <h3>Where should it go?</h3>
        <p className="muted">
          Share your requirements with the supplier to receive a quotation.
        </p>
      </div>
      <fieldset disabled={busy} className="form-grid">
        <legend className="sr-only">Contact and delivery information</legend>
        {deliveryFields.map(([name, label, type, maxLength, autoComplete]) => (
          <div
            key={name}
            className={name === "addressLine" ? "full-width" : undefined}
          >
            <label htmlFor={`${reservationId}-${name}`}>{label}</label>
            <input
              id={`${reservationId}-${name}`}
              name={name}
              type={type}
              maxLength={maxLength}
              autoComplete={autoComplete}
              required
              defaultValue={
                name === "company"
                  ? company
                  : name === "country"
                    ? "India"
                    : undefined
              }
            />
          </div>
        ))}
        <div>
          <label htmlFor={`${reservationId}-method`}>Fulfillment</label>
          <select id={`${reservationId}-method`} name="deliveryMethod">
            <option value="DELIVERY">Delivery to address</option>
            <option value="PICKUP">Arrange pickup</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${reservationId}-date`}>
            Preferred date <span className="optional">optional</span>
          </label>
          <input
            id={`${reservationId}-date`}
            name="requestedDate"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div>
          <label htmlFor={`${reservationId}-tax`}>
            Tax / GST number <span className="optional">optional</span>
          </label>
          <input id={`${reservationId}-tax`} name="taxId" maxLength={40} />
        </div>
        <div className="full-width">
          <label htmlFor={`${reservationId}-notes`}>
            Delivery instructions & requirements{" "}
            <span className="optional">optional</span>
          </label>
          <textarea
            id={`${reservationId}-notes`}
            name="notes"
            rows={3}
            maxLength={2000}
            placeholder="Access restrictions, packaging, intended use, or quality requirements"
          />
        </div>
        <p className="field-hint full-width">
          These details are saved with your request and shared with the
          supplying organization. Pickup requests use your address for the
          quotation.
        </p>
        <div className="button-row full-width">
          <button type="submit" className="primary-button">
            {busy ? "Saving request…" : "Request quotation"}
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Back
          </button>
        </div>
      </fieldset>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function QuotationForm({
  orderId,
  organizationId,
  unit,
  onChanged,
}: {
  orderId: string;
  organizationId: string;
  unit: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quote = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await apiRequest(
        `/api/orders/${orderId}/quotation`,
        jsonOptions("POST", quote, organizationId),
      );
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="order-form"
      onSubmit={submit}
      aria-label={`Quotation for order ${orderId}`}
    >
      <h3>Prepare quotation</h3>
      <fieldset disabled={busy} className="form-grid">
        <legend className="sr-only">Quotation amounts in INR</legend>
        <div>
          <label htmlFor={`${orderId}-price`}>Unit price (INR / {unit})</label>
          <input
            id={`${orderId}-price`}
            name="unitPrice"
            type="number"
            min="0.01"
            max="9999999999.99"
            step="0.01"
            required
          />
        </div>
        <div>
          <label htmlFor={`${orderId}-freight`}>Freight (INR)</label>
          <input
            id={`${orderId}-freight`}
            name="freight"
            type="number"
            min="0"
            max="9999999999.99"
            step="0.01"
            defaultValue="0.00"
            required
          />
        </div>
        <div>
          <label htmlFor={`${orderId}-taxPercent`}>Tax (%)</label>
          <input
            id={`${orderId}-taxPercent`}
            name="taxPercent"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue="0"
            required
          />
        </div>
        <div>
          <label htmlFor={`${orderId}-validity`}>Valid until (UTC)</label>
          <input
            id={`${orderId}-validity`}
            name="validUntil"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            required
          />
        </div>
        <div className="full-width">
          <label htmlFor={`${orderId}-terms`}>Payment & delivery terms</label>
          <textarea
            id={`${orderId}-terms`}
            name="terms"
            rows={3}
            maxLength={2000}
            required
            placeholder="Payment schedule, dispatch lead time, packaging and transport terms"
          />
        </div>
        <p className="field-hint full-width">
          Tax applies to materials plus freight. The quotation will be available
          here for the buyer to review.
        </p>
        <button type="submit" className="primary-button">
          {busy ? "Saving quotation…" : "Issue quotation"}
        </button>
      </fieldset>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function Amount({ value }: { value: string | null }) {
  if (value === null) return <>—</>;
  const [whole, fraction = "00"] = value.split(".");
  return (
    <>
      ₹{BigInt(whole).toLocaleString("en-IN")}.{fraction.padEnd(2, "0")}
    </>
  );
}

function DeliveryDetails({ details }: { details: Fulfillment }) {
  return (
    <div className="delivery-summary">
      <div>
        <p className="eyebrow">Contact & destination</p>
        <h3>{details.company}</h3>
        <p>
          {details.contactName} · {details.phone}
        </p>
        <p>{details.email}</p>
        <p>
          {details.addressLine}, {details.city}, {details.region}{" "}
          {details.postalCode}, {details.country}
        </p>
      </div>
      <div>
        <p className="muted">
          {details.deliveryMethod === "PICKUP"
            ? "Buyer-arranged pickup"
            : "Delivery requested"}
          {details.requestedDate ? ` · Preferred ${details.requestedDate}` : ""}
        </p>
        {details.taxId ? <p>Tax ID · {details.taxId}</p> : null}
        {details.notes ? (
          <p className="preserve-lines">{details.notes}</p>
        ) : null}
      </div>
    </div>
  );
}

export function OrderDetails({
  order,
  organizationId,
  supplier,
  unit,
  onChanged,
}: {
  order: Order;
  organizationId: string;
  supplier: boolean;
  unit: string;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const details = order.fulfillment;
  if (!details)
    return (
      <p className="field-hint">
        Order {order.orderId} · Delivery details were not recorded for this
        earlier order.
      </p>
    );
  const expired =
    details.validUntil !== null &&
    details.validUntil < new Date().toISOString().slice(0, 10);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/orders/${order.orderId}/confirm`, {
        method: "POST",
        headers: { "X-Organization-Id": organizationId },
      });
      onChanged(
        "Order confirmed. Coordinate dispatch with the supplier using the agreed terms.",
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="order-details">
      <div className="section-heading">
        <span className="batch-code">
          Order MX-{order.orderId.padStart(5, "0")}
        </span>
        <span className="tag">
          {details.status === "QUOTE_REQUESTED"
            ? "Awaiting quotation"
            : details.status === "QUOTED"
              ? expired
                ? "Quotation expired"
                : "Quotation ready"
              : "Confirmed"}
        </span>
      </div>
      <DeliveryDetails details={details} />
      {details.status === "QUOTE_REQUESTED" ? (
        supplier ? (
          <QuotationForm
            orderId={order.orderId}
            organizationId={organizationId}
            unit={unit}
            onChanged={() =>
              onChanged(
                "Quotation issued. The buyer can now review and confirm it.",
              )
            }
          />
        ) : (
          <p className="field-hint">
            Your request is saved. The supplier will provide pricing and
            delivery terms here.
          </p>
        )
      ) : (
        <div className="quotation-summary">
          <div className="section-heading">
            <h3>Quotation</h3>
            <span className="field-hint">
              Valid through {details.validUntil} (UTC)
            </span>
          </div>
          <dl className="quotation-amounts">
            <div>
              <dt>Unit price / {unit}</dt>
              <dd>
                <Amount value={details.unitPrice} />
              </dd>
            </div>
            <div>
              <dt>Materials</dt>
              <dd>
                <Amount value={details.subtotal} />
              </dd>
            </div>
            <div>
              <dt>Freight</dt>
              <dd>
                <Amount value={details.freight} />
              </dd>
            </div>
            <div>
              <dt>Tax ({details.taxPercent}%)</dt>
              <dd>
                <Amount value={details.taxAmount} />
              </dd>
            </div>
            <div className="quotation-total">
              <dt>Total · INR</dt>
              <dd>
                <Amount value={details.total} />
              </dd>
            </div>
          </dl>
          <p className="preserve-lines">{details.terms}</p>
          {!supplier && details.status === "QUOTED" ? (
            <>
              <p className="field-hint">
                Confirming accepts the pricing and fulfillment terms above.
              </p>
              <button
                className="primary-button"
                type="button"
                disabled={busy || expired}
                onClick={() => void confirm()}
              >
                {busy
                  ? "Confirming…"
                  : expired
                    ? "Quotation expired"
                    : "Accept quotation & confirm order"}
              </button>
            </>
          ) : null}
          {details.status === "CONFIRMED" ? (
            <p className="field-hint">
              Confirmed{" "}
              {new Date(details.confirmedAt ?? order.placedAt).toLocaleString()}
              . Dispatch is coordinated with the supplier.
            </p>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
