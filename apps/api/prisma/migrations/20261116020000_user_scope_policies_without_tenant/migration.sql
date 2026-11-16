-- The user-scoped read policies (own memberships / own organizations) must apply ONLY when no
-- tenant context is set. Inside a tenant transaction they would otherwise be OR-ed with the tenant
-- policy and add the caller's memberships in OTHER organizations to tenant-scoped queries.

DROP POLICY "memberships_own_read" ON "memberships";
CREATE POLICY "memberships_own_read" ON "memberships"
  FOR SELECT
  USING (app.current_organization_id() IS NULL AND "user_id" = app.current_user_id());

DROP POLICY "organizations_member_read" ON "organizations";
CREATE POLICY "organizations_member_read" ON "organizations"
  FOR SELECT
  USING (
    app.current_organization_id() IS NULL
    AND "id" IN (
      SELECT m."organization_id" FROM "memberships" m
      WHERE m."user_id" = app.current_user_id() AND m."status" = 'ACTIVE'
    )
  );
