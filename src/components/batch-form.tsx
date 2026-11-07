"use client";

import { type FormEvent, useState } from "react";
import {
  apiRequest,
  type Batch,
  errorMessage,
  jsonOptions,
  type Material,
  positiveQuantity,
  useApiData,
} from "./exchange-api";

export function BatchForm({
  organizationId,
  batch,
  onSaved,
}: {
  organizationId: string;
  batch?: Batch;
  onSaved: (batch: Batch) => void;
}) {
  const catalog = useApiData<{ items: Material[] }>(
    batch ? null : "/api/materials",
    organizationId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const body = {
        description: String(fields.get("description") ?? ""),
        location: String(fields.get("location") ?? ""),
        totalQuantity: positiveQuantity(
          String(fields.get("totalQuantity") ?? ""),
        ),
        ...(batch
          ? { status: fields.get("status") ?? batch.status }
          : {
              materialId: fields.get("materialId"),
              batchCode: fields.get("batchCode"),
            }),
      };
      const saved = await apiRequest<Batch>(
        batch ? `/api/batches/${batch.batchId}` : "/api/batches",
        jsonOptions(batch ? "PATCH" : "POST", body, organizationId),
      );
      onSaved(saved);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="panel exchange-panel"
      onSubmit={submit}
      aria-label={batch ? "Edit batch" : "Publish batch"}
    >
      <h2>{batch ? "Edit this batch" : "Batch information"}</h2>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {catalog.error ? (
        <div className="inline-error">
          <p role="alert">{catalog.error}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={catalog.retry}
          >
            Retry materials
          </button>
        </div>
      ) : null}
      <fieldset
        disabled={busy || (!batch && !catalog.data)}
        className="exchange-fields"
      >
        {!batch ? (
          <div className="filter-grid">
            <div>
              <label htmlFor="publish-material">Material</label>
              <select
                id="publish-material"
                name="materialId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select a material
                </option>
                {catalog.data?.items.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} ({material.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="batch-code">Batch code</label>
              <input id="batch-code" name="batchCode" required maxLength={64} />
            </div>
          </div>
        ) : null}
        <div className="filter-grid">
          <div>
            <label htmlFor="batch-location">Location</label>
            <input
              id="batch-location"
              name="location"
              required
              maxLength={160}
              defaultValue={batch?.location}
            />
          </div>
          <div>
            <label htmlFor="batch-total">
              Total quantity{batch ? ` (${batch.material.unit})` : ""}
            </label>
            <input
              id="batch-total"
              name="totalQuantity"
              inputMode="decimal"
              required
              defaultValue={batch?.totalQuantity}
              aria-describedby="total-hint"
            />
            <p id="total-hint" className="field-hint">
              Use the material's unit. Up to three decimal places.
            </p>
          </div>
          {batch ? (
            <div>
              <label htmlFor="batch-status">Status</label>
              <select
                id="batch-status"
                name="status"
                defaultValue={batch.status}
                disabled={batch.status === "CLOSED"}
              >
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
              </select>
              <p className="field-hint">Closing stops new reservations.</p>
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor="batch-description">Description</label>
          <textarea
            id="batch-description"
            name="description"
            rows={4}
            defaultValue={batch?.description}
          />
        </div>
        <button className="primary-button" type="submit">
          {busy ? "Saving…" : batch ? "Save changes" : "Publish batch"}
        </button>
      </fieldset>
    </form>
  );
}
