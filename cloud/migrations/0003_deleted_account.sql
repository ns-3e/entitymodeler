-- Stands in as creator of workspaces and models that outlive a deleted account, because created_by can't be null.
-- It can never sign in: it's suspended, and its email has no "@", so no sign-in method can match it.
INSERT INTO users (id, email, name, created_at, suspended_at)
VALUES ('deleted-account', 'deleted-account.invalid', 'Deleted account', '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
