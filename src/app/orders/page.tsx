import { WorkspaceGate } from "@/components/organization-session";
import { OrdersDashboard } from "@/components/workspace-dashboards";

export default function Orders() {
  return (
    <WorkspaceGate requiredRole="CONSUMER">
      <OrdersDashboard />
    </WorkspaceGate>
  );
}
