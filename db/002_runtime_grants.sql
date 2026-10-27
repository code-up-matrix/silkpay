-- Administrator applies this only after app_service creation is authorized.
-- The migration runner intentionally applies only 001_silkpay.sql.
GRANT USAGE ON SCHEMA public TO app_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, purchase_orders, sessions,
 invitations, milestones, evidence, rate_limits, webhook_receipts TO app_service;
GRANT SELECT, INSERT ON audit_events TO app_service;
