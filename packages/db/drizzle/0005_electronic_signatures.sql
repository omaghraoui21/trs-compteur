-- ============================================================
-- 0005_electronic_signatures.sql — 21 CFR Part 11 e-signatures
-- Append-only table of signing events (re-authenticated). Captures
-- signer identity, meaning, and timestamp. Immutable by trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS electronic_signatures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users (id),
  user_email  text NOT NULL,
  user_name   text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  meaning     text NOT NULL,
  action      text NOT NULL,
  comment     text,
  ip_address  text,
  signed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esign_entity ON electronic_signatures (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_esign_user   ON electronic_signatures (user_id);
CREATE INDEX IF NOT EXISTS idx_esign_signed ON electronic_signatures (signed_at);

-- Immutability: a signature, once applied, can never be altered or removed.
CREATE OR REPLACE FUNCTION fn_esign_immutable()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'electronic_signatures is append-only: UPDATE and DELETE are prohibited (entity=% id=%)',
    OLD.entity_type, OLD.entity_id;
END;
$$;

CREATE TRIGGER tgr_esign_no_update
  BEFORE UPDATE ON electronic_signatures
  FOR EACH ROW EXECUTE FUNCTION fn_esign_immutable();

CREATE TRIGGER tgr_esign_no_delete
  BEFORE DELETE ON electronic_signatures
  FOR EACH ROW EXECUTE FUNCTION fn_esign_immutable();
