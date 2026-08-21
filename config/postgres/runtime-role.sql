\set ON_ERROR_STOP on

\if :{?runtime_role}
\else
  \echo 'Set runtime_role before running this file, for example: -v runtime_role=provider_tracker_runtime'
  \quit 1
\endif

SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50',
  :'runtime_role'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50',
  :'runtime_role'
)
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE TEMP ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_role') \gexec
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_events FROM :"runtime_role";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

SELECT format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', :'runtime_role', current_database(), '15s') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L', :'runtime_role', current_database(), '5s') \gexec
SELECT format('ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L', :'runtime_role', current_database(), '30s') \gexec

\echo 'Runtime grants applied. Set or rotate the role password through the approved secret manager.'
