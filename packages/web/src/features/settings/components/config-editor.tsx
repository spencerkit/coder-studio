/**
 * Config Editor Component
 *
 * Enhanced UI for viewing and editing Codex and Claude config files.
 * Features:
 * - Collapsible card container
 * - Smart status indicator
 * - Format button for JSON
 * - Auto-resize editor
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { FileJson2, CheckCircle, Circle, RefreshCw, XCircle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { pushToastAtom } from '../../notifications/atoms';
import { MonacoHost } from '../../code-editor/components/monaco-host';

export type ConfigType = 'codex' | 'claude';

interface ConfigEditorProps {
  configType: ConfigType;
}

interface ConfigReadResult {
  configPath: string;
  content: string;
  exists: boolean;
}

interface ConfigWriteResult {
  success: boolean;
  backupPath: string | null;
  error?: string;
}

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export function ConfigEditor({ configType }: ConfigEditorProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [configPath, setConfigPath] = useState('');
  const [fileExists, setFileExists] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(() => {
    // Restore from localStorage
    const stored = localStorage.getItem(`config-expanded-${configType}`);
    return stored !== null ? stored === 'true' : true;
  });

  // Compute save status
  const saveStatus: SaveStatus = useMemo(() => {
    if (isSaving) return 'saving';
    if (error) return 'error';
    if (content !== originalContent) return 'dirty';
    return 'saved';
  }, [isSaving, error, content, originalContent]);

  const isDirty = saveStatus === 'dirty';

  // Load config file on mount or when configType changes
  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await dispatch<ConfigReadResult>('settings.readConfigFile', {
          configType,
        });

        if (cancelled) return;

        if (result.ok && result.data) {
          setContent(result.data.content);
          setOriginalContent(result.data.content);
          setConfigPath(result.data.configPath);
          setFileExists(result.data.exists);
        } else {
          setError(result.error?.message ?? t('settings.config_files.load_failed'));
        }
      } catch {
        if (!cancelled) {
          setError(t('settings.config_files.load_failed'));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [configType, dispatch, t]);

  // Persist expanded state
  useEffect(() => {
    localStorage.setItem(`config-expanded-${configType}`, String(isExpanded));
  }, [isExpanded, configType]);

  const handleSave = useCallback(async () => {
    if (!isDirty || isSaving) return;

    setIsSaving(true);

    try {
      const result = await dispatch<ConfigWriteResult>('settings.writeConfigFile', {
        configType,
        content,
      });

      if (result.ok && result.data?.success) {
        pushToast({
          kind: 'success',
          title: t('settings.config_files.save_success'),
          body: result.data.backupPath
            ? t('settings.config_files.backup_created', { path: result.data.backupPath })
            : undefined,
        });
        setOriginalContent(content);
        setError(null);
      } else {
        const errorMsg = result.error?.message ?? result.data?.error;
        setError(errorMsg ?? 'Save failed');
        pushToast({
          kind: 'error',
          title: t('settings.config_files.save_failed'),
          body: errorMsg,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Save failed';
      setError(errorMsg);
      pushToast({
        kind: 'error',
        title: t('settings.config_files.save_failed'),
      });
    } finally {
      setIsSaving(false);
    }
  }, [configType, content, isDirty, isSaving, dispatch, pushToast, t]);

  const handleRevert = useCallback(() => {
    setContent(originalContent);
    setError(null);
  }, [originalContent]);

  const handleFormat = useCallback(() => {
    if (configType === 'claude') {
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        setContent(formatted);
        pushToast({
          kind: 'success',
          title: 'JSON formatted',
        });
      } catch {
        pushToast({
          kind: 'error',
          title: 'Invalid JSON',
          body: 'Cannot format invalid JSON',
        });
      }
    }
    // TOML formatting not implemented
  }, [configType, content, pushToast]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setError(null);
  }, []);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Status indicator component
  const StatusIndicator = () => {
    const statusConfig = {
      saved: { icon: CheckCircle, color: 'success', text: t('settings.config_files.status_saved') },
      dirty: { icon: Circle, color: 'warning', text: t('settings.config_files.unsaved_changes') },
      saving: { icon: RefreshCw, color: 'info', text: t('settings.config_files.saving') },
      error: { icon: XCircle, color: 'error', text: t('settings.config_files.save_failed') },
    };

    const config = statusConfig[saveStatus];
    const Icon = config.icon;

    return (
      <div className={`config-status config-status--${config.color}`}>
        <Icon size={14} className={saveStatus === 'saving' ? 'animate-spin' : ''} />
        <span>{config.text}</span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="config-card">
        <div className="config-card-loading">{t('common.loading')}</div>
      </div>
    );
  }

  // Error state - but still show the card
  if (error && !configPath) {
    return (
      <div className="config-card">
        <div className="config-card-error">
          <span className="config-card-error-message">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="config-card">
      {/* Header */}
      <div className="config-card-header" onClick={handleToggle}>
        <div className="config-card-title">
          <FileJson2 size={16} />
          <span className="config-card-path">{configPath}</span>
        </div>
        <div className="config-card-header-right">
          <StatusIndicator />
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="config-card-body">
          {!fileExists && (
            <div className="config-empty-state">
              <div className="config-empty-icon">📭</div>
              <div className="config-empty-title">{t('settings.config_files.file_not_found')}</div>
              <div className="config-empty-desc">{t('settings.config_files.file_not_found_hint')}</div>
            </div>
          )}

          {fileExists && (
            <>
              <MonacoHost
                workspaceId="config-editor"
                filePath={configPath}
                content={content}
                onContentChange={handleContentChange}
              />

              {/* Actions */}
              <div className="config-card-actions">
                <div className="config-actions-left">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleToggle}
                    title={t('settings.config_files.collapse')}
                  >
                    <ChevronDown size={14} />
                    <span>{t('settings.config_files.collapse')}</span>
                  </button>
                </div>

                <div className="config-actions-right">
                  {configType === 'claude' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleFormat}
                      title={t('settings.config_files.format_hint')}
                    >
                      <Sparkles size={14} />
                      <span>{t('settings.config_files.format')}</span>
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleRevert}
                    disabled={!isDirty || isSaving}
                  >
                    {t('action.reset')}
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                  >
                    {isSaving ? t('settings.config_files.saving') : t('action.save')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}