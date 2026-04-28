/**
 * Config Editor Component
 *
 * UI for viewing and editing Codex and Claude config files.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
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

export function ConfigEditor({ configType }: ConfigEditorProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [configPath, setConfigPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = content !== originalContent;

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
      } else {
        pushToast({
          kind: 'error',
          title: t('settings.config_files.save_failed'),
          body: result.error?.message ?? result.data?.error,
        });
      }
    } catch {
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
  }, [originalContent]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  if (isLoading) {
    return (
      <div className="settings-config-editor">
        <div className="settings-config-loading">{t('common.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-config-editor">
        <div className="settings-config-error">
          <span className="settings-config-error-message">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-config-editor">
      {/* File path display */}
      <div className="settings-config-path-bar">
        <span className="settings-config-path-label">{t('settings.config_files.path_label')}:</span>
        <span className="settings-config-path-value">{configPath}</span>
      </div>

      {/* Monaco editor */}
      <MonacoHost
        workspaceId="config-editor"
        filePath={configPath}
        content={content}
        onContentChange={handleContentChange}
      />

      {/* Status bar + action buttons */}
      <div className="settings-config-actions">
        <div className="settings-config-status">
          {isDirty && (
            <span className="settings-config-dirty">
              {t('settings.config_files.unsaved_changes')}
            </span>
          )}
        </div>

        <div className="settings-config-buttons">
          <button
            className="btn btn-secondary"
            onClick={handleRevert}
            disabled={!isDirty || isSaving}
          >
            {t('action.reset')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? t('settings.config_files.saving') : t('action.save')}
          </button>
        </div>
      </div>
    </div>
  );
}