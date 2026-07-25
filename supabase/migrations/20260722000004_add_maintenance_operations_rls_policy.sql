-- RLS policy for pipeline_maintenance_operations
-- Service role bypasses RLS (used by the db client with service_role key).
-- Application users access replacement info through project/template APIs, not this table.

CREATE POLICY service_role_all ON pipeline_maintenance_operations
  FOR ALL
  TO service_role
  USING (true);
