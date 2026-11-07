export const batchSelect = `
  SELECT b.id AS batchId, b.supplier_org_id AS supplierOrgId, b.material_id AS materialId,
         m.name AS materialName, m.category, m.unit, b.batch_code AS batchCode,
         b.description, b.location, b.total_quantity AS totalQuantity, b.status, b.revision,
         b.total_quantity - COALESCE((
           SELECT SUM(r.quantity) FROM reservations AS r
           WHERE r.batch_id = b.id AND r.status IN ('ACTIVE', 'CONVERTED')
         ), 0) AS availableQuantity
  FROM batches AS b JOIN materials AS m ON m.id = b.material_id
`;
