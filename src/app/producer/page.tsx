import { WorkspaceGate } from "@/components/organization-session";
import { ProducerDashboard } from "@/components/workspace-dashboards";

export default function Producer() {
  return (
    <WorkspaceGate requiredRole="PRODUCER">
      <ProducerDashboard />
    </WorkspaceGate>
  );
}
