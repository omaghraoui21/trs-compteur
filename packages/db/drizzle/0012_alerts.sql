CREATE TABLE IF NOT EXISTS alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid REFERENCES equipments(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('trs_below', 'downtime_duration', 'session_stale', 'validation_pending')),
  threshold numeric(10,2) NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_equipment ON alert_rules(equipment_id);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  equipment_id uuid REFERENCES equipments(id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES lot_entries(id) ON DELETE CASCADE,
  entity_key text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(acknowledged_at, triggered_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_active_entity ON alerts(rule_id, entity_key) WHERE acknowledged_at IS NULL;
