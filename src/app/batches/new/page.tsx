import { BatchPublish } from "@/components/batch-publish";
import { WorkspaceGate } from "@/components/organization-session";

export default function PublishPage() {
  return (
    <WorkspaceGate requiredRole="PRODUCER">
      <BatchPublish />
    </WorkspaceGate>
  );
}
