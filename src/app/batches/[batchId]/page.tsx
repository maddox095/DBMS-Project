import { BatchDetail } from "@/components/batch-detail";

export default async function BatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return <BatchDetail batchId={batchId} />;
}
