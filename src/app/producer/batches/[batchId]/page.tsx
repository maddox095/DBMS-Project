import { BatchDetail } from "@/components/batch-detail";
import { WorkspaceGate } from "@/components/organization-session";

export default async function ProducerBatch({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return (
    <WorkspaceGate requiredRole="PRODUCER">
      <BatchDetail batchId={batchId} mode="PRODUCER" />
    </WorkspaceGate>
  );
}
