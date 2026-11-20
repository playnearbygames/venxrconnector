-- Cached details about a connection (e.g. the Meta ad accounts the user granted), shown on the dashboard.
alter table connections add column if not exists metadata jsonb not null default '{}'::jsonb;
