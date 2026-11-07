import { BatchDetail } from "@/components/batch-detail";
import { WorkspaceGate } from "@/components/organization-session";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return (
    <WorkspaceGate requiredRole="CONSUMER">
      <BatchDetail batchId={batchId} />
    </WorkspaceGate>
  );
}
