-- Backfill once. Reapplying must preserve role assignments.
SET @add_role = (SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'organizations' AND column_name = 'role');
SET @role_ddl = IF(@add_role,
  'ALTER TABLE organizations ADD COLUMN role ENUM(''CONSUMER'', ''PRODUCER'') NOT NULL DEFAULT ''CONSUMER''',
  'SELECT 1');
PREPARE role_migration FROM @role_ddl;
EXECUTE role_migration;
DEALLOCATE PREPARE role_migration;
SET @role_backfill = IF(@add_role,
  'UPDATE organizations SET role = ''PRODUCER'' WHERE (id = 1 AND name = ''Deccan Thermal Works'') OR id IN (SELECT supplier_org_id FROM batches)',
  'SELECT 1');
PREPARE role_migration FROM @role_backfill;
EXECUTE role_migration;
DEALLOCATE PREPARE role_migration;
