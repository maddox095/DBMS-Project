import { WorkspaceGate } from "@/components/organization-session";
import { OrdersDashboard } from "@/components/workspace-dashboards";

export default function Incoming() {
  return (
    <WorkspaceGate requiredRole="PRODUCER">
      <OrdersDashboard />
    </WorkspaceGate>
  );
}
