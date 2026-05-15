-- Add missing RLS policies for "user" and "company" tables.
--
-- "user" SELECT must work without app.current_company_id because the
-- auth login flow queries by email before any tenant context is set.
-- Mutations require explicit company context (enforced by withTenant).
--
-- "company" SELECT also allows no-context (needed during auth / seeding).
-- INSERT is unrestricted (superuser / service role creates companies).
-- UPDATE / DELETE require company context.

-- ────────────────────────────────────────────────────────────────────
-- user
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY user_select ON "user" FOR SELECT
  USING (
    nullif(current_setting('app.current_company_id', true), '') IS NULL
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

CREATE POLICY user_insert ON "user" FOR INSERT
  WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);

CREATE POLICY user_update ON "user" FOR UPDATE
  USING  (company_id = current_setting('app.current_company_id')::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);

CREATE POLICY user_delete ON "user" FOR DELETE
  USING (company_id = current_setting('app.current_company_id')::uuid);

-- ────────────────────────────────────────────────────────────────────
-- company
-- ────────────────────────────────────────────────────────────────────
CREATE POLICY company_select ON company FOR SELECT
  USING (
    nullif(current_setting('app.current_company_id', true), '') IS NULL
    OR company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  );

-- Company rows are created by the seed / onboarding path which runs
-- outside a tenant transaction, so no company context check here.
CREATE POLICY company_insert ON company FOR INSERT
  WITH CHECK (true);

CREATE POLICY company_update ON company FOR UPDATE
  USING  (company_id = current_setting('app.current_company_id')::uuid)
  WITH CHECK (company_id = current_setting('app.current_company_id')::uuid);

CREATE POLICY company_delete ON company FOR DELETE
  USING (company_id = current_setting('app.current_company_id')::uuid);
