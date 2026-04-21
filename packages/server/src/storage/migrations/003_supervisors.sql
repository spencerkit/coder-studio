CREATE UNIQUE INDEX idx_sessions_id_workspace ON sessions(id, workspace_id);

CREATE TABLE supervisors (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  last_cycle_at INTEGER,
  last_evaluated_turn_id TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_id, workspace_id) REFERENCES sessions(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_supervisors_workspace ON supervisors(workspace_id);
CREATE INDEX idx_supervisors_session ON supervisors(session_id);
CREATE UNIQUE INDEX idx_supervisors_id_session ON supervisors(id, session_id);

CREATE TABLE supervisor_cycles (
  id TEXT PRIMARY KEY,
  supervisor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  objective TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  turn_id TEXT,
  progress INTEGER,
  result TEXT,
  injected_guidance TEXT,
  error_reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (supervisor_id, session_id) REFERENCES supervisors(id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_supervisor_cycles_supervisor ON supervisor_cycles(supervisor_id, created_at DESC);
CREATE INDEX idx_supervisor_cycles_session ON supervisor_cycles(session_id, created_at DESC);
