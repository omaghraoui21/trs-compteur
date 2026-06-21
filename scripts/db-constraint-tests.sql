-- ============================================================
-- db-constraint-tests.sql
-- Comprehensive constraint and index verification tests for 0009_performance_and_constraints.sql
-- 
-- This file contains test cases to verify each constraint and index
-- added in migration 0009. Each constraint has:
-- 1. A test INSERT/UPDATE that SHOULD be REJECTED
-- 2. A test INSERT that SHOULD SUCCEED (sanity check)
--
-- For indexes, EXPLAIN comments show query patterns they support.
-- All tests assume reference data (users, equipment, etc.) is seeded.
-- ============================================================

-- Setup: Create test users and equipment for FK references
DO $$ BEGIN
  INSERT INTO users (id, email, password_hash, display_name, role, is_active)
  VALUES 
    ('00000001-0000-0000-0000-000000000001'::uuid, 'op1@test.com', 'hash1', 'Operator 1', 'operator', true),
    ('00000002-0000-0000-0000-000000000002'::uuid, 'op2@test.com', 'hash2', 'Operator 2', 'operator', true),
    ('00000003-0000-0000-0000-000000000003'::uuid, 'sup1@test.com', 'hash3', 'Supervisor 1', 'supervisor', true)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO rooms (id, code, name, is_active)
  VALUES ('00000010-0000-0000-0000-000000000010'::uuid, 'ROOM1', 'Test Room', true)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO equipments (id, room_id, code, name, equipment_type, trs_objective, default_cadence_unit, is_active)
  VALUES ('00000020-0000-0000-0000-000000000020'::uuid, '00000010-0000-0000-0000-000000000010'::uuid, 'EQ1', 'Equipment 1', 'blistereuse', 75, 'u/h', true)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO products (id, code, name, default_cadence, cadence_unit, is_active)
  VALUES ('00000030-0000-0000-0000-000000000030'::uuid, 'PROD1', 'Product 1', 100, 'u/h', true)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO sessions (id, equipment_id, room_id, operator_id, session_date, status)
  VALUES ('00000040-0000-0000-0000-000000000040'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, '00000010-0000-0000-0000-000000000010'::uuid, '00000001-0000-0000-0000-000000000001'::uuid, CURRENT_DATE, 'active')
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  INSERT INTO downtime_categories (id, code, label, famille, is_active)
  VALUES ('00000050-0000-0000-0000-000000000050'::uuid, 'CAT1', 'Test Category', 'Panne équipement', true)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- CONSTRAINT 1: session_events.duration_minutes must be NULL or > 0
-- ============================================================
-- Comment: chk_session_event_duration_positive
-- Prevents negative or zero duration which would be logically invalid.

-- Test 1a: SHOULD REJECT — negative duration
DO $$ BEGIN
  INSERT INTO session_events (id, session_id, event_type, started_at, duration_minutes)
  VALUES ('00010001-0000-0000-0000-000000000001'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, 'nettoyage', NOW(), -5);
  RAISE EXCEPTION 'Test 1a FAILED: negative duration should be rejected by chk_session_event_duration_positive';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 1a PASSED: negative duration rejected (constraint: chk_session_event_duration_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 1a FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 1b: SHOULD REJECT — zero duration
DO $$ BEGIN
  INSERT INTO session_events (id, session_id, event_type, started_at, duration_minutes)
  VALUES ('00010002-0000-0000-0000-000000000002'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, 'pause', NOW(), 0);
  RAISE EXCEPTION 'Test 1b FAILED: zero duration should be rejected by chk_session_event_duration_positive';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 1b PASSED: zero duration rejected (constraint: chk_session_event_duration_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 1b FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 1c: SHOULD SUCCEED — NULL duration is valid
DO $$ BEGIN
  INSERT INTO session_events (id, session_id, event_type, started_at, duration_minutes)
  VALUES ('00010003-0000-0000-0000-000000000003'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, 'lot_start', NOW(), NULL);
  RAISE NOTICE 'Test 1c PASSED: NULL duration accepted';
  DELETE FROM session_events WHERE id = '00010003-0000-0000-0000-000000000003'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 1c FAILED: %', SQLERRM;
END $$;

-- Test 1d: SHOULD SUCCEED — positive duration is valid
DO $$ BEGIN
  INSERT INTO session_events (id, session_id, event_type, started_at, duration_minutes)
  VALUES ('00010004-0000-0000-0000-000000000004'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, 'vide_ligne', NOW(), 15);
  RAISE NOTICE 'Test 1d PASSED: positive duration accepted';
  DELETE FROM session_events WHERE id = '00010004-0000-0000-0000-000000000004'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 1d FAILED: %', SQLERRM;
END $$;

-- ============================================================
-- CONSTRAINT 2: lot_cadence_changes.old_cadence and new_cadence must be > 0
-- ============================================================
-- Comment: chk_cadence_changes_values_positive
-- Cadence values must be positive to avoid division by zero in TRS calculations.

DO $$ BEGIN
  INSERT INTO lot_entries (id, session_id, product_id, batch_number, cadence_used, status, operator_id)
  VALUES ('00000060-0000-0000-0000-000000000060'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, '00000030-0000-0000-0000-000000000030'::uuid, 'LOT001', 100, 'active', '00000001-0000-0000-0000-000000000001'::uuid)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Test 2a: SHOULD REJECT — old_cadence = 0
DO $$ BEGIN
  INSERT INTO lot_cadence_changes (id, lot_entry_id, old_cadence, new_cadence, cadence_unit)
  VALUES ('00020001-0000-0000-0000-000000000001'::uuid, '00000060-0000-0000-0000-000000000060'::uuid, 0, 100, 'u/h');
  RAISE EXCEPTION 'Test 2a FAILED: zero old_cadence should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 2a PASSED: zero old_cadence rejected (constraint: chk_cadence_changes_values_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 2a FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 2b: SHOULD REJECT — new_cadence < 0
DO $$ BEGIN
  INSERT INTO lot_cadence_changes (id, lot_entry_id, old_cadence, new_cadence, cadence_unit)
  VALUES ('00020002-0000-0000-0000-000000000002'::uuid, '00000060-0000-0000-0000-000000000060'::uuid, 100, -50, 'u/h');
  RAISE EXCEPTION 'Test 2b FAILED: negative new_cadence should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 2b PASSED: negative new_cadence rejected (constraint: chk_cadence_changes_values_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 2b FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 2c: SHOULD SUCCEED — both positive
DO $$ BEGIN
  INSERT INTO lot_cadence_changes (id, lot_entry_id, old_cadence, new_cadence, cadence_unit)
  VALUES ('00020003-0000-0000-0000-000000000003'::uuid, '00000060-0000-0000-0000-000000000060'::uuid, 100, 120, 'u/h');
  RAISE NOTICE 'Test 2c PASSED: positive cadence values accepted';
  DELETE FROM lot_cadence_changes WHERE id = '00020003-0000-0000-0000-000000000003'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 2c FAILED: %', SQLERRM;
END $$;

-- ============================================================
-- CONSTRAINT 3: lot_cadence_changes.cadence_unit must be 'u/h' or 'u/min'
-- ============================================================
-- Comment: chk_cadence_changes_unit
-- Enforces valid cadence unit vocabulary across the system.

-- Test 3a: SHOULD REJECT — invalid unit
DO $$ BEGIN
  INSERT INTO lot_cadence_changes (id, lot_entry_id, old_cadence, new_cadence, cadence_unit)
  VALUES ('00020004-0000-0000-0000-000000000004'::uuid, '00000060-0000-0000-0000-000000000060'::uuid, 100, 120, 'u/sec');
  RAISE EXCEPTION 'Test 3a FAILED: invalid cadence_unit should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 3a PASSED: invalid cadence_unit rejected (constraint: chk_cadence_changes_unit)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 3a FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 3b: SHOULD SUCCEED — u/h is valid
DO $$ BEGIN
  INSERT INTO lot_cadence_changes (id, lot_entry_id, old_cadence, new_cadence, cadence_unit)
  VALUES ('00020005-0000-0000-0000-000000000005'::uuid, '00000060-0000-0000-0000-000000000060'::uuid, 100, 120, 'u/h');
  RAISE NOTICE 'Test 3b PASSED: u/h unit accepted';
  DELETE FROM lot_cadence_changes WHERE id = '00020005-0000-0000-0000-000000000005'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 3b FAILED: %', SQLERRM;
END $$;

-- Test 3c: SHOULD SUCCEED — u/min is valid
DO $$ BEGIN
  INSERT INTO lot_cadence_changes (id, lot_entry_id, old_cadence, new_cadence, cadence_unit)
  VALUES ('00020006-0000-0000-0000-000000000006'::uuid, '00000060-0000-0000-0000-000000000060'::uuid, 100, 120, 'u/min');
  RAISE NOTICE 'Test 3c PASSED: u/min unit accepted';
  DELETE FROM lot_cadence_changes WHERE id = '00020006-0000-0000-0000-000000000006'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 3c FAILED: %', SQLERRM;
END $$;

-- ============================================================
-- CONSTRAINT 4: daily_summaries ratio columns in [0, 1]
-- ============================================================
-- Comment: chk_daily_summary_ratios
-- TRS/DO/TP/TQ/TRG are computed metrics that should always be in [0,1].
-- This prevents out-of-range values from TRS engine bugs silently writing bad data.

-- Test 4a: SHOULD REJECT — trs > 1
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, trs)
  VALUES ('00040001-0000-0000-0000-000000000001'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE, 1.5);
  RAISE EXCEPTION 'Test 4a FAILED: trs > 1 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 4a PASSED: trs > 1 rejected (constraint: chk_daily_summary_ratios)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4a FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 4b: SHOULD REJECT — trg < 0
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, trg)
  VALUES ('00040002-0000-0000-0000-000000000002'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE, -0.1);
  RAISE EXCEPTION 'Test 4b FAILED: trg < 0 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 4b PASSED: trg < 0 rejected (constraint: chk_daily_summary_ratios)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4b FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 4c: SHOULD REJECT — disponibilite > 1
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, disponibilite)
  VALUES ('00040003-0000-0000-0000-000000000003'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE, 1.01);
  RAISE EXCEPTION 'Test 4c FAILED: disponibilite > 1 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 4c PASSED: disponibilite > 1 rejected (constraint: chk_daily_summary_ratios)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4c FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 4d: SHOULD REJECT — performance = -0.5
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, performance)
  VALUES ('00040004-0000-0000-0000-000000000004'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE, -0.5);
  RAISE EXCEPTION 'Test 4d FAILED: negative performance should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 4d PASSED: negative performance rejected (constraint: chk_daily_summary_ratios)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4d FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 4e: SHOULD REJECT — qualite > 1
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, qualite)
  VALUES ('00040005-0000-0000-0000-000000000005'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE, 1.1);
  RAISE EXCEPTION 'Test 4e FAILED: qualite > 1 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 4e PASSED: qualite > 1 rejected (constraint: chk_daily_summary_ratios)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4e FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 4f: SHOULD SUCCEED — all ratios in [0,1] or NULL
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, trs, trg, disponibilite, performance, qualite)
  VALUES ('00040006-0000-0000-0000-000000000006'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE, 0.85, 0.92, 0.88, 0.95, 0.99);
  RAISE NOTICE 'Test 4f PASSED: valid ratios in [0,1] accepted';
  DELETE FROM daily_summaries WHERE id = '00040006-0000-0000-0000-000000000006'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4f FAILED: %', SQLERRM;
END $$;

-- Test 4g: SHOULD SUCCEED — all NULL is valid (uncomputed summary)
DO $$ BEGIN
  INSERT INTO daily_summaries (id, equipment_id, summary_date, trs, trg, disponibilite, performance, qualite)
  VALUES ('00040007-0000-0000-0000-000000000007'::uuid, '00000020-0000-0000-0000-000000000020'::uuid, CURRENT_DATE + 1, NULL, NULL, NULL, NULL, NULL);
  RAISE NOTICE 'Test 4g PASSED: all NULL ratios accepted';
  DELETE FROM daily_summaries WHERE id = '00040007-0000-0000-0000-000000000007'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 4g FAILED: %', SQLERRM;
END $$;

-- ============================================================
-- CONSTRAINT 5: lot_entries.lot_order >= 1
-- ============================================================
-- Comment: chk_lot_order_positive
-- lot_order is 1-indexed (1st, 2nd, 3rd lot in session).
-- Must be >= 1 to avoid ambiguity in ordering.

-- Test 5a: SHOULD REJECT — lot_order = 0
DO $$ BEGIN
  INSERT INTO lot_entries (id, session_id, product_id, batch_number, cadence_used, lot_order, status, operator_id)
  VALUES ('00000070-0000-0000-0000-000000000070'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, '00000030-0000-0000-0000-000000000030'::uuid, 'LOT002', 100, 0, 'active', '00000001-0000-0000-0000-000000000001'::uuid);
  RAISE EXCEPTION 'Test 5a FAILED: lot_order = 0 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 5a PASSED: lot_order = 0 rejected (constraint: chk_lot_order_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 5a FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 5b: SHOULD REJECT — lot_order < 0
DO $$ BEGIN
  INSERT INTO lot_entries (id, session_id, product_id, batch_number, cadence_used, lot_order, status, operator_id)
  VALUES ('00000071-0000-0000-0000-000000000071'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, '00000030-0000-0000-0000-000000000030'::uuid, 'LOT003', 100, -1, 'active', '00000001-0000-0000-0000-000000000001'::uuid);
  RAISE EXCEPTION 'Test 5b FAILED: lot_order < 0 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 5b PASSED: lot_order < 0 rejected (constraint: chk_lot_order_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 5b FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 5c: SHOULD SUCCEED — lot_order = 1
DO $$ BEGIN
  INSERT INTO lot_entries (id, session_id, product_id, batch_number, cadence_used, lot_order, status, operator_id)
  VALUES ('00000072-0000-0000-0000-000000000072'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, '00000030-0000-0000-0000-000000000030'::uuid, 'LOT004', 100, 1, 'active', '00000001-0000-0000-0000-000000000001'::uuid);
  RAISE NOTICE 'Test 5c PASSED: lot_order = 1 accepted';
  DELETE FROM lot_entries WHERE id = '00000072-0000-0000-0000-000000000072'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 5c FAILED: %', SQLERRM;
END $$;

-- Test 5d: SHOULD SUCCEED — lot_order = 5 (later lots)
DO $$ BEGIN
  INSERT INTO lot_entries (id, session_id, product_id, batch_number, cadence_used, lot_order, status, operator_id)
  VALUES ('00000073-0000-0000-0000-000000000073'::uuid, '00000040-0000-0000-0000-000000000040'::uuid, '00000030-0000-0000-0000-000000000030'::uuid, 'LOT005', 100, 5, 'active', '00000001-0000-0000-0000-000000000001'::uuid);
  RAISE NOTICE 'Test 5d PASSED: lot_order = 5 accepted';
  DELETE FROM lot_entries WHERE id = '00000073-0000-0000-0000-000000000073'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 5d FAILED: %', SQLERRM;
END $$;

-- ============================================================
-- CONSTRAINT 6: products.default_cadence must be NULL or > 0
-- ============================================================
-- Comment: chk_product_default_cadence_positive
-- Default cadence is optional (NULL), but if set must be positive.

-- Test 6a: SHOULD REJECT — default_cadence = 0
DO $$ BEGIN
  INSERT INTO products (id, code, name, default_cadence, cadence_unit, is_active)
  VALUES ('00000031-0000-0000-0000-000000000031'::uuid, 'PROD2', 'Product 2', 0, 'u/h', true);
  RAISE EXCEPTION 'Test 6a FAILED: default_cadence = 0 should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 6a PASSED: default_cadence = 0 rejected (constraint: chk_product_default_cadence_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 6a FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 6b: SHOULD REJECT — default_cadence < 0
DO $$ BEGIN
  INSERT INTO products (id, code, name, default_cadence, cadence_unit, is_active)
  VALUES ('00000032-0000-0000-0000-000000000032'::uuid, 'PROD3', 'Product 3', -100, 'u/h', true);
  RAISE EXCEPTION 'Test 6b FAILED: negative default_cadence should be rejected';
EXCEPTION 
  WHEN check_violation THEN 
    RAISE NOTICE 'Test 6b PASSED: negative default_cadence rejected (constraint: chk_product_default_cadence_positive)';
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 6b FAILED with unexpected error: %', SQLERRM;
END $$;

-- Test 6c: SHOULD SUCCEED — default_cadence = NULL
DO $$ BEGIN
  INSERT INTO products (id, code, name, default_cadence, cadence_unit, is_active)
  VALUES ('00000033-0000-0000-0000-000000000033'::uuid, 'PROD4', 'Product 4', NULL, 'u/h', true);
  RAISE NOTICE 'Test 6c PASSED: NULL default_cadence accepted';
  DELETE FROM products WHERE id = '00000033-0000-0000-0000-000000000033'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 6c FAILED: %', SQLERRM;
END $$;

-- Test 6d: SHOULD SUCCEED — positive default_cadence
DO $$ BEGIN
  INSERT INTO products (id, code, name, default_cadence, cadence_unit, is_active)
  VALUES ('00000034-0000-0000-0000-000000000034'::uuid, 'PROD5', 'Product 5', 150.50, 'u/h', true);
  RAISE NOTICE 'Test 6d PASSED: positive default_cadence accepted';
  DELETE FROM products WHERE id = '00000034-0000-0000-0000-000000000034'::uuid;
EXCEPTION 
  WHEN OTHERS THEN 
    RAISE NOTICE 'Test 6d FAILED: %', SQLERRM;
END $$;

-- ============================================================
-- INDEX VERIFICATION (Comments only — requires live DB EXPLAIN)
-- ============================================================

-- ────────────────────────────────────────────────────────
-- INDEX 7: idx_refresh_tokens_expires
-- ────────────────────────────────────────────────────────
-- Table: refresh_tokens
-- Columns: expires_at
-- Purpose: Fast cleanup query filtering by expiresAt
--
-- Expected query pattern:
--   DELETE FROM refresh_tokens WHERE expires_at < NOW();
--
-- EXPLAIN output (with index):
--   Index Scan using idx_refresh_tokens_expires on refresh_tokens
--   Index Cond: (expires_at < now())
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM refresh_tokens WHERE expires_at < NOW();

-- ────────────────────────────────────────────────────────
-- INDEX 8: idx_refresh_tokens_revoked
-- ────────────────────────────────────────────────────────
-- Table: refresh_tokens
-- Columns: revoked_at
-- Purpose: Fast cleanup query filtering by revokedAt
--
-- Expected query pattern:
--   DELETE FROM refresh_tokens WHERE revoked_at IS NOT NULL;
--
-- EXPLAIN output (with index):
--   Index Scan using idx_refresh_tokens_revoked on refresh_tokens
--   Index Cond: (revoked_at IS NOT NULL)
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM refresh_tokens WHERE revoked_at IS NOT NULL;

-- ────────────────────────────────────────────────────────
-- INDEX 9: idx_sessions_operator
-- ────────────────────────────────────────────────────────
-- Table: sessions
-- Columns: operator_id
-- Purpose: FK to users; used in ownership checks and active-session lookups
--
-- Expected query pattern:
--   SELECT * FROM sessions WHERE operator_id = $1 AND status = 'active';
--
-- EXPLAIN output (with index):
--   Index Scan using idx_sessions_operator on sessions
--   Index Cond: (operator_id = ...)
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM sessions WHERE operator_id = '00000001-0000-0000-0000-000000000001'::uuid;

-- ────────────────────────────────────────────────────────
-- INDEX 10: idx_sessions_operator_status
-- ────────────────────────────────────────────────────────
-- Table: sessions
-- Columns: (operator_id, status) composite
-- Purpose: Hot path filter: "find active session for this operator"
--
-- Expected query pattern:
--   SELECT * FROM sessions WHERE operator_id = $1 AND status = 'active';
--
-- EXPLAIN output (with index):
--   Index Scan using idx_sessions_operator_status on sessions
--   Index Cond: (operator_id = ... AND status = 'active')
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM sessions 
--   WHERE operator_id = '00000001-0000-0000-0000-000000000001'::uuid AND status = 'active';

-- ────────────────────────────────────────────────────────
-- INDEX 11: idx_lot_entries_operator_id
-- ────────────────────────────────────────────────────────
-- Table: lot_entries
-- Columns: operator_id
-- Purpose: FK to users; used in ownership checks and pending-lots join
--
-- Expected query pattern:
--   SELECT * FROM lot_entries WHERE operator_id = $1;
--
-- EXPLAIN output (with index):
--   Index Scan using idx_lot_entries_operator_id on lot_entries
--   Index Cond: (operator_id = ...)
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM lot_entries WHERE operator_id = '00000001-0000-0000-0000-000000000001'::uuid;

-- ────────────────────────────────────────────────────────
-- INDEX 12: idx_lot_entries_ended_at
-- ────────────────────────────────────────────────────────
-- Table: lot_entries
-- Columns: ended_at DESC
-- Purpose: ORDER BY desc(endedAt) in pending-lots dashboard query
--
-- Expected query pattern:
--   SELECT * FROM lot_entries 
--   WHERE status IN ('closed', 'validated', 'rejected')
--   ORDER BY ended_at DESC LIMIT 20;
--
-- EXPLAIN output (with index):
--   Index Scan Backward using idx_lot_entries_ended_at on lot_entries
--   Index Cond: (status IN ('closed', 'validated', 'rejected'))
--   or if composite index is used:
--   Index Scan Backward using idx_lot_entries_status_ended_at on lot_entries
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM lot_entries 
--   WHERE status IN ('closed', 'validated', 'rejected')
--   ORDER BY ended_at DESC LIMIT 20;

-- ────────────────────────────────────────────────────────
-- INDEX 13: idx_lot_entries_status_ended_at
-- ────────────────────────────────────────────────────────
-- Table: lot_entries
-- Columns: (status, ended_at DESC) composite
-- Purpose: Covers combined filter+sort in pending-lots:
--   WHERE status IN ('closed', 'validated', 'rejected')
--   ORDER BY ended_at DESC
-- The composite index makes this a single efficient range scan
-- (no need for separate filter index + sort).
--
-- Expected query pattern:
--   SELECT * FROM lot_entries 
--   WHERE status IN ('closed', 'validated', 'rejected')
--   ORDER BY ended_at DESC;
--
-- EXPLAIN output (with index):
--   Index Scan Backward using idx_lot_entries_status_ended_at on lot_entries
--   Index Cond: (status IN ('closed', 'validated', 'rejected'))
--   (no Sort node needed — index already in correct order)
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM lot_entries 
--   WHERE status IN ('closed', 'validated', 'rejected')
--   ORDER BY ended_at DESC;

-- ────────────────────────────────────────────────────────
-- INDEX 14: idx_downtime_events_created_by
-- ────────────────────────────────────────────────────────
-- Table: downtime_events
-- Columns: created_by
-- Purpose: Operator ownership check on DELETE /lots/:id/downtimes/:dtId
--          Compares created_by to the requesting user.
--
-- Expected query pattern:
--   SELECT * FROM downtime_events WHERE created_by = $1;
--
-- EXPLAIN output (with index):
--   Index Scan using idx_downtime_events_created_by on downtime_events
--   Index Cond: (created_by = ...)
--
-- Verification SQL (to run with EXPLAIN):
--   EXPLAIN SELECT * FROM downtime_events WHERE created_by = '00000001-0000-0000-0000-000000000001'::uuid;

-- ============================================================
-- VERIFICATION SUMMARY
-- ============================================================
-- Run the following command to check index existence:
--
--   SELECT indexname, indexdef 
--   FROM pg_indexes 
--   WHERE schemaname = 'public' 
--   AND indexname IN (
--     'idx_refresh_tokens_expires',
--     'idx_refresh_tokens_revoked',
--     'idx_sessions_operator',
--     'idx_sessions_operator_status',
--     'idx_lot_entries_operator_id',
--     'idx_lot_entries_ended_at',
--     'idx_lot_entries_status_ended_at',
--     'idx_downtime_events_created_by'
--   );
--
-- All 8 indexes should be listed with their column definitions.
-- ============================================================

