-- Homologación de agentes: cada carga guarda cómo vienen escritos los nombres de sus agentes
-- (sábana: ejecutivo, tipificaciones y CRM: agente). La herramienta agrupa esas formas sola
-- ("MARIA LOPEZ", "María López", "lopez maria"...) y muestra un solo nombre por agente.
CREATE TABLE IF NOT EXISTS agent_names (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  campaign TEXT NOT NULL,
  raw TEXT NOT NULL,
  rows INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (upload_id, raw)
);
CREATE INDEX IF NOT EXISTS agent_names_campaign_idx ON agent_names (campaign);

-- Nombres de lo que ya estaba cargado.
INSERT OR IGNORE INTO agent_names (upload_id, campaign, raw, rows)
  SELECT s.upload_id, u.campaign, TRIM(s.executive), COUNT(*)
    FROM bank_sales s JOIN uploads u ON u.id = s.upload_id
   WHERE u.status <> 'descartada' AND TRIM(COALESCE(s.executive, '')) <> ''
   GROUP BY s.upload_id, TRIM(s.executive);
INSERT OR IGNORE INTO agent_names (upload_id, campaign, raw, rows)
  SELECT c.upload_id, u.campaign, TRIM(c.agent), COUNT(*)
    FROM calls c JOIN uploads u ON u.id = c.upload_id
   WHERE u.status <> 'descartada' AND TRIM(COALESCE(c.agent, '')) <> ''
   GROUP BY c.upload_id, TRIM(c.agent);
INSERT OR IGNORE INTO agent_names (upload_id, campaign, raw, rows)
  SELECT c.upload_id, u.campaign, TRIM(c.agent), COUNT(*)
    FROM crm_sales c JOIN uploads u ON u.id = c.upload_id
   WHERE u.status <> 'descartada' AND TRIM(COALESCE(c.agent, '')) <> ''
   GROUP BY c.upload_id, TRIM(c.agent);
