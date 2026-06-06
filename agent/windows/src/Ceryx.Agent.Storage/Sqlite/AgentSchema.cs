namespace Ceryx.Agent.Storage.Sqlite;

public static class AgentSchema
{
    public const string Sql = """
        CREATE TABLE IF NOT EXISTS paired_devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          platform TEXT NOT NULL,
          client_type TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          permissions_json TEXT NOT NULL,
          cert_fingerprint TEXT NOT NULL DEFAULT '',
          wol_json TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS remote_sessions (
          id TEXT PRIMARY KEY,
          controller_device_id TEXT,
          started_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL DEFAULT 'info',
          session_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_configs (
          id TEXT PRIMARY KEY,
          project_name TEXT NOT NULL,
          project_root TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS media_assets (
          id TEXT PRIMARY KEY,
          asset_type TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_settings (
          id TEXT PRIMARY KEY,
          http_port INTEGER NOT NULL DEFAULT 41527,
          direct_test_command TEXT NOT NULL DEFAULT 'dotnet test agent/windows/Ceryx.Agent.Windows.sln',
          allow_fullscreen_capture INTEGER NOT NULL DEFAULT 0,
          allow_clear_logs INTEGER NOT NULL DEFAULT 0,
          default_capture_mode TEXT NOT NULL DEFAULT 'balanced',
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_reads (
          notification_id TEXT PRIMARY KEY,
          read_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          cleared_before TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
        ON audit_logs(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_audit_logs_filters
        ON audit_logs(severity, action, session_id, created_at DESC);
        """;
}
