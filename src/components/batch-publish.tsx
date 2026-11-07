"use client";

import { useRouter } from "next/navigation";
import { BatchForm } from "./batch-form";
import { OrganizationPicker, useDemoSession } from "./demo-session";

export function BatchPublish() {
  const session = useDemoSession();
  const router = useRouter();
  return (
    <>
      <section className="discovery-hero detail-hero">
        <div>
          <p className="eyebrow">Supply materials</p>
          <h1>Publish a batch.</h1>
          <p className="hero-copy">
            Describe your available material and its quantity so recipients can
            find it.
          </p>
        </div>
        <OrganizationPicker session={session} />
      </section>
      {session.organizationId && !session.selecting ? (
        <BatchForm
          key={session.organizationId}
          organizationId={session.organizationId}
          onSaved={(batch) => router.push(`/batches/${batch.batchId}`)}
        />
      ) : (
        <p className="empty-panel">
          Choose the organization supplying this batch.
        </p>
      )}
    </>
  );
}
