/**
 * MCP Server Settings Component (Phase 4)
 *
 * UI for viewing and configuring MCP servers for Claude/Codex.
 */

import { useState, useCallback } from 'react';
import { useAtom } from 'jotai';
import type { McpServerConfig, McpServerStatus } from '@coder-studio/core';
import { useTranslation } from '../../../lib/i18n';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { atomWithStorage } from 'jotai/utils';

type Provider = 'claude' | 'codex';

// Store MCP configs in localStorage
export const mcpConfigAtom = atomWithStorage<{
  claude: McpServerConfig[];
  codex: McpServerConfig[];
}>('ui.mcpConfig', {
  claude: [],
  codex: [],
});

export function McpSettings() {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [mcpConfig, setMcpConfig] = useAtom(mcpConfigAtom);
  const [activeProvider, setActiveProvider] = useState<Provider>('claude');
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const servers = mcpConfig[activeProvider];

  const handleToggleServer = useCallback(
    (name: string) => {
      setMcpConfig((prev) => ({
        ...prev,
        [activeProvider]: prev[activeProvider].map((s) =>
          s.name === name ? { ...s, enabled: !s.enabled } : s
        ),
      }));
    },
    [activeProvider, setMcpConfig]
  );

  const handleDeleteServer = useCallback(
    (name: string) => {
      setMcpConfig((prev) => ({
        ...prev,
        [activeProvider]: prev[activeProvider].filter((s) => s.name !== name),
      }));
    },
    [activeProvider, setMcpConfig]
  );

  const handleAddServer = useCallback(
    (server: McpServerConfig) => {
      setMcpConfig((prev) => ({
        ...prev,
        [activeProvider]: [...prev[activeProvider], server],
      }));
      setShowAddForm(false);
    },
    [activeProvider, setMcpConfig]
  );

  const handleUpdateServer = useCallback(
    (server: McpServerConfig) => {
      setMcpConfig((prev) => ({
        ...prev,
        [activeProvider]: prev[activeProvider].map((s) =>
          s.name === editingServer?.name ? server : s
        ),
      }));
      setEditingServer(null);
    },
    [activeProvider, editingServer, setMcpConfig]
  );

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t('settings.mcp.title')}</h2>
      <p className="settings-group-desc">{t('settings.mcp.hint')}</p>

      {/* Provider Tabs */}
      <div className="settings-pills mcp-provider-tabs">
        <button
          className={`settings-pill ${activeProvider === 'claude' ? 'settings-pill-active' : ''}`}
          onClick={() => setActiveProvider('claude')}
        >
          Claude
        </button>
        <button
          className={`settings-pill ${activeProvider === 'codex' ? 'settings-pill-active' : ''}`}
          onClick={() => setActiveProvider('codex')}
        >
          Codex
        </button>
      </div>

      {/* Server List */}
      <div className="mcp-server-list">
        {servers.length === 0 ? (
          <div className="mcp-empty">
            {t('settings.mcp.no_servers')}
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.name}
              className={`mcp-server-item ${server.enabled ? '' : 'mcp-server-disabled'}`}
            >
              <div className="mcp-server-header">
                <span className="mcp-server-name">{server.name}</span>
                <span className={`mcp-server-status ${server.enabled ? 'enabled' : 'disabled'}`}>
                  {server.enabled ? t('settings.mcp.enabled') : t('settings.mcp.disabled')}
                </span>
              </div>

              <div className="mcp-server-command">
                <code>{server.command} {server.args.join(' ')}</code>
              </div>

              {server.description && (
                <div className="mcp-server-desc">{server.description}</div>
              )}

              <div className="mcp-server-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditingServer(server)}
                >
                  {t('action.settings')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleToggleServer(server.name)}
                >
                  {server.enabled ? t('settings.mcp.disable') : t('settings.mcp.enable')}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => handleDeleteServer(server.name)}
                >
                  {t('action.delete')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Server Button */}
      {!showAddForm && !editingServer && (
        <button
          className="btn btn-secondary"
          onClick={() => setShowAddForm(true)}
        >
          + {t('settings.mcp.add_server')}
        </button>
      )}

      {/* Add/Edit Form */}
      {(showAddForm || editingServer) && (
        <McpServerForm
          server={editingServer}
          onSave={editingServer ? handleUpdateServer : handleAddServer}
          onCancel={() => {
            setShowAddForm(false);
            setEditingServer(null);
          }}
        />
      )}
    </div>
  );
}

interface McpServerFormProps {
  server: McpServerConfig | null;
  onSave: (server: McpServerConfig) => void;
  onCancel: () => void;
}

function McpServerForm({ server, onSave, onCancel }: McpServerFormProps) {
  const [name, setName] = useState(server?.name || '');
  const [command, setCommand] = useState(server?.command || '');
  const [args, setArgs] = useState(server?.args.join(' ') || '');
  const [description, setDescription] = useState(server?.description || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      command,
      args: args.split(' ').filter(Boolean),
      description: description || undefined,
      enabled: server?.enabled ?? true,
    });
  };

  return (
    <form className="mcp-server-form" onSubmit={handleSubmit}>
      <h3 className="mcp-form-title">
        {server ? '编辑 Server' : '添加 Server'}
      </h3>

      <div className="form-group">
        <label>名称</label>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-mcp-server"
          disabled={!!server}
          required
        />
      </div>

      <div className="form-group">
        <label>命令</label>
        <input
          type="text"
          className="input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npx"
          required
        />
      </div>

      <div className="form-group">
        <label>参数</label>
        <input
          type="text"
          className="input"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="-y @modelcontextprotocol/server-filesystem"
        />
      </div>

      <div className="form-group">
        <label>描述</label>
        <input
          type="text"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Server 描述（可选）"
        />
      </div>

      <div className="mcp-form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn-primary">
          保存
        </button>
      </div>
    </form>
  );
}
