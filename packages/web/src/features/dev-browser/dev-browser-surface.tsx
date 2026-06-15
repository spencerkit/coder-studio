import { useAtom, useStore } from "jotai";
import { RotateCw } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState, Notice } from "../../components/ui";
import { Select, type SelectOption } from "../../components/ui/select";
import { useTranslation } from "../../lib/i18n";
import { useWorkspaceUiStatePersistence } from "../workspace/actions/use-workspace-ui-state-persistence";
import {
  activeEditorTabAtomFamily,
  type DevBrowserDevicePreset,
  type DevBrowserOrientation,
  type DevBrowserUserAgentMode,
  MAX_BROWSER_VIEWPORT_DIMENSION,
  openEditorTabsAtomFamily,
  type WorkspaceBrowserEditorTab,
  type WorkspaceEditorTab,
} from "../workspace/atoms";
import {
  createDevBrowserSession,
  type DevBrowserSessionResponse,
  deleteDevBrowserSession,
} from "./api";
import { currentDevBrowserUrlAtomFamily, pendingDevBrowserUrlAtomFamily } from "./atoms";

function supportsDevBrowserServiceWorker(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    navigator.serviceWorker !== undefined
  );
}

interface DevBrowserSurfaceProps {
  browserTab: WorkspaceBrowserEditorTab;
  workspaceId: string;
}

function replaceBrowserTab(
  openEditorTabs: WorkspaceEditorTab[],
  nextBrowserTab: WorkspaceBrowserEditorTab
): WorkspaceEditorTab[] {
  let replaced = false;
  const nextTabs = openEditorTabs.map((tab) => {
    if (tab.kind === "browser" && tab.id === nextBrowserTab.id) {
      replaced = true;
      return nextBrowserTab;
    }

    return tab;
  });

  return replaced ? nextTabs : [...nextTabs, nextBrowserTab];
}

const DEVICE_PRESETS: Record<
  Exclude<DevBrowserDevicePreset, "custom">,
  { height: number | null; width: number | null; userAgentMode: DevBrowserUserAgentMode }
> = {
  desktop: { width: null, height: null, userAgentMode: "desktop" },
  "iphone-14": { width: 390, height: 844, userAgentMode: "mobile" },
  "pixel-7": { width: 412, height: 915, userAgentMode: "mobile" },
};
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

interface DeviceSettingsDraft {
  devicePreset: DevBrowserDevicePreset;
  orientation: DevBrowserOrientation;
  userAgentMode: DevBrowserUserAgentMode;
  viewportWidthInput: string;
  viewportHeightInput: string;
}

interface ResolvedDeviceSettings {
  devicePreset: DevBrowserDevicePreset;
  orientation: DevBrowserOrientation;
  userAgentMode: DevBrowserUserAgentMode;
  viewportWidth: number | null;
  viewportHeight: number | null;
}

function toViewportInput(value: number | null) {
  return value === null ? "" : String(value);
}

function createDraftFromBrowserTab(browserTab: WorkspaceBrowserEditorTab): DeviceSettingsDraft {
  return {
    devicePreset: browserTab.devicePreset,
    orientation: browserTab.orientation,
    userAgentMode: browserTab.userAgentMode,
    viewportWidthInput: toViewportInput(browserTab.viewportWidth),
    viewportHeightInput: toViewportInput(browserTab.viewportHeight),
  };
}

function applyPreset(
  devicePreset: DevBrowserDevicePreset,
  orientation: DevBrowserOrientation,
  previousDraft: DeviceSettingsDraft
): DeviceSettingsDraft {
  if (devicePreset === "custom") {
    return {
      ...previousDraft,
      devicePreset,
      orientation,
    };
  }

  const preset = DEVICE_PRESETS[devicePreset];
  let width = preset.width;
  let height = preset.height;
  if (orientation === "landscape" && width !== null && height !== null) {
    [width, height] = [height, width];
  }

  return {
    devicePreset,
    orientation,
    userAgentMode: preset.userAgentMode,
    viewportWidthInput: toViewportInput(width),
    viewportHeightInput: toViewportInput(height),
  };
}

function synchronizeDraftWithPreset(
  draft: DeviceSettingsDraft,
  devicePreset: DevBrowserDevicePreset
): DeviceSettingsDraft {
  if (devicePreset === draft.devicePreset) {
    return draft;
  }

  return applyPreset(devicePreset, draft.orientation, draft);
}

function rotateDraft(currentDraft: DeviceSettingsDraft): DeviceSettingsDraft {
  const nextOrientation = currentDraft.orientation === "portrait" ? "landscape" : "portrait";
  if (currentDraft.devicePreset === "desktop") {
    return {
      ...currentDraft,
      orientation: nextOrientation,
    };
  }

  if (currentDraft.devicePreset === "custom") {
    return {
      ...currentDraft,
      orientation: nextOrientation,
      viewportWidthInput: currentDraft.viewportHeightInput,
      viewportHeightInput: currentDraft.viewportWidthInput,
    };
  }

  return applyPreset(currentDraft.devicePreset, nextOrientation, currentDraft);
}

function parseViewportDimension(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_BROWSER_VIEWPORT_DIMENSION
    ? parsed
    : null;
}

function resolveDeviceSettings(draft: DeviceSettingsDraft): ResolvedDeviceSettings | null {
  if (draft.devicePreset === "desktop") {
    return {
      devicePreset: "desktop",
      orientation: draft.orientation,
      userAgentMode: "desktop",
      viewportWidth: null,
      viewportHeight: null,
    };
  }

  const viewportWidth = parseViewportDimension(draft.viewportWidthInput);
  const viewportHeight = parseViewportDimension(draft.viewportHeightInput);
  if (viewportWidth === null || viewportHeight === null) {
    return null;
  }

  return {
    devicePreset: draft.devicePreset,
    orientation: draft.orientation,
    userAgentMode: draft.userAgentMode,
    viewportWidth,
    viewportHeight,
  };
}

function deriveUserAgent(userAgentMode: DevBrowserUserAgentMode): string | undefined {
  if (userAgentMode === "mobile") {
    return MOBILE_USER_AGENT;
  }

  return undefined;
}

export function DevBrowserSurface({ browserTab, workspaceId }: DevBrowserSurfaceProps) {
  const t = useTranslation();
  const store = useStore();
  const persistedTargetUrl = browserTab.url?.trim() ?? "";
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const [url, setUrl] = useState(persistedTargetUrl);
  const [draft, setDraft] = useState<DeviceSettingsDraft>(() =>
    createDraftFromBrowserTab(browserTab)
  );
  const [appliedBrowserTab, setAppliedBrowserTab] = useState<WorkspaceBrowserEditorTab>(browserTab);
  const [session, setSession] = useState<DevBrowserSessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useAtom(pendingDevBrowserUrlAtomFamily(workspaceId));
  const [, setCurrentUrl] = useAtom(currentDevBrowserUrlAtomFamily(workspaceId));
  const sessionRef = useRef<DevBrowserSessionResponse | null>(null);
  const autoOpenedUrlRef = useRef<string | null>(null);
  const frameShellRef = useRef<HTMLDivElement | null>(null);
  const serviceWorkerSupported = supportsDevBrowserServiceWorker();
  const [frameScale, setFrameScale] = useState(1);

  const resolvedDraft = useMemo(() => resolveDeviceSettings(draft), [draft]);
  const viewportWidth = appliedBrowserTab.viewportWidth;
  const viewportHeight = appliedBrowserTab.viewportHeight;
  const hasFixedViewport =
    appliedBrowserTab.devicePreset !== "desktop" &&
    viewportWidth !== null &&
    viewportHeight !== null;
  const deviceOptions: ReadonlyArray<SelectOption<DevBrowserDevicePreset>> = useMemo(
    () => [
      { value: "desktop", label: t("dev_browser.device_desktop") },
      { value: "iphone-14", label: t("dev_browser.device_iphone_14") },
      { value: "pixel-7", label: t("dev_browser.device_pixel_7") },
      { value: "custom", label: t("dev_browser.device_custom") },
    ],
    [t]
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!persistedTargetUrl || url.trim().length > 0) {
      return;
    }

    setUrl(persistedTargetUrl);
  }, [persistedTargetUrl, url]);

  useEffect(() => {
    setDraft(createDraftFromBrowserTab(browserTab));
  }, [
    browserTab.devicePreset,
    browserTab.id,
    browserTab.orientation,
    browserTab.userAgentMode,
    browserTab.viewportHeight,
    browserTab.viewportWidth,
  ]);

  useEffect(() => {
    setAppliedBrowserTab(browserTab);
  }, [
    browserTab.devicePreset,
    browserTab.id,
    browserTab.orientation,
    browserTab.url,
    browserTab.userAgentMode,
    browserTab.viewportHeight,
    browserTab.viewportWidth,
  ]);

  useEffect(() => {
    return () => {
      const activeSession = sessionRef.current;
      setCurrentUrl(null);
      if (activeSession) {
        void deleteDevBrowserSession(activeSession.id).catch(() => undefined);
      }
    };
  }, [setCurrentUrl]);

  const openTargetUrl = useCallback(
    async (targetUrl: string, nextDeviceSettings: ResolvedDeviceSettings) => {
      const nextUrl = targetUrl.trim();
      if (loading || !nextUrl) {
        return;
      }

      const nextBrowserTab: WorkspaceBrowserEditorTab = {
        ...appliedBrowserTab,
        url: nextUrl,
        devicePreset: nextDeviceSettings.devicePreset,
        viewportWidth: nextDeviceSettings.viewportWidth,
        viewportHeight: nextDeviceSettings.viewportHeight,
        orientation: nextDeviceSettings.orientation,
        userAgentMode: nextDeviceSettings.userAgentMode,
      };
      const nextOpenEditorTabs = replaceBrowserTab(
        store.get(openEditorTabsAtomFamily(workspaceId)),
        nextBrowserTab
      );
      setUrl(nextUrl);
      autoOpenedUrlRef.current = nextUrl;
      setLoading(true);
      setError(null);
      const previousSession = sessionRef.current;
      try {
        const created = await createDevBrowserSession(nextUrl, {
          userAgent: deriveUserAgent(nextDeviceSettings.userAgentMode),
        });
        setSession(created);
        setCurrentUrl(created.displayUrl ?? `${created.targetOrigin}/`);
        if (previousSession) {
          void deleteDevBrowserSession(previousSession.id).catch(() => undefined);
        }
        setAppliedBrowserTab(nextBrowserTab);
        store.set(openEditorTabsAtomFamily(workspaceId), nextOpenEditorTabs);
        store.set(activeEditorTabAtomFamily(workspaceId), nextBrowserTab);
        await persistUiState({
          openEditorTabs: nextOpenEditorTabs,
          activeEditorTab: nextBrowserTab,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "dev_browser_open_failed");
      } finally {
        setLoading(false);
      }
    },
    [appliedBrowserTab, loading, persistUiState, setCurrentUrl, store, workspaceId]
  );

  const persistDeviceSettings = useCallback(
    async (nextDeviceSettings: ResolvedDeviceSettings) => {
      const nextBrowserTab: WorkspaceBrowserEditorTab = {
        ...appliedBrowserTab,
        devicePreset: nextDeviceSettings.devicePreset,
        viewportWidth: nextDeviceSettings.viewportWidth,
        viewportHeight: nextDeviceSettings.viewportHeight,
        orientation: nextDeviceSettings.orientation,
        userAgentMode: nextDeviceSettings.userAgentMode,
      };
      const nextOpenEditorTabs = replaceBrowserTab(
        store.get(openEditorTabsAtomFamily(workspaceId)),
        nextBrowserTab
      );
      setAppliedBrowserTab(nextBrowserTab);
      store.set(openEditorTabsAtomFamily(workspaceId), nextOpenEditorTabs);
      store.set(activeEditorTabAtomFamily(workspaceId), nextBrowserTab);
      await persistUiState({
        openEditorTabs: nextOpenEditorTabs,
        activeEditorTab: nextBrowserTab,
      });
    },
    [appliedBrowserTab, persistUiState, store, workspaceId]
  );

  const commitDeviceSettings = useCallback(
    async (nextDraft: DeviceSettingsDraft) => {
      const nextDeviceSettings = resolveDeviceSettings(nextDraft);
      if (!nextDeviceSettings) {
        setError("dev_browser_invalid_viewport");
        return;
      }

      setError(null);
      if (!appliedBrowserTab.url) {
        await persistDeviceSettings(nextDeviceSettings);
        return;
      }

      await openTargetUrl(appliedBrowserTab.url, nextDeviceSettings);
    },
    [appliedBrowserTab.url, openTargetUrl, persistDeviceSettings]
  );

  useEffect(() => {
    if (!persistedTargetUrl) {
      autoOpenedUrlRef.current = null;
      return;
    }

    if (loading || session !== null || autoOpenedUrlRef.current === persistedTargetUrl) {
      return;
    }

    const persistedDeviceSettings = resolveDeviceSettings(createDraftFromBrowserTab(browserTab));
    if (!persistedDeviceSettings) {
      return;
    }

    void openTargetUrl(persistedTargetUrl, persistedDeviceSettings);
  }, [browserTab, loading, openTargetUrl, persistedTargetUrl, session]);

  useEffect(() => {
    if (!pendingUrl || loading) {
      return;
    }

    setPendingUrl(null);
    if (!browserTab.url) {
      const persistedDeviceSettings = resolveDeviceSettings(createDraftFromBrowserTab(browserTab));
      if (!persistedDeviceSettings) {
        return;
      }
      void openTargetUrl(pendingUrl, persistedDeviceSettings);
    }
  }, [browserTab, browserTab.url, loading, openTargetUrl, pendingUrl, setPendingUrl]);

  useEffect(() => {
    if (!hasFixedViewport || !frameShellRef.current) {
      setFrameScale(1);
      return;
    }

    const shellRect = frameShellRef.current.getBoundingClientRect();
    if (shellRect.width <= 0 || shellRect.height <= 0) {
      setFrameScale(1);
      return;
    }
    const nextScale = Math.min(
      1,
      (shellRect.width - 32) / viewportWidth,
      (shellRect.height - 32) / viewportHeight
    );
    const clampedScale = Number(Math.max(0, nextScale).toFixed(3));
    setFrameScale(clampedScale);
  }, [hasFixedViewport, session, viewportHeight, viewportWidth]);

  const submitCurrentUrl = useCallback(
    async (targetUrl: string) => {
      const nextDeviceSettings = resolvedDraft;
      if (!nextDeviceSettings) {
        setError("dev_browser_invalid_viewport");
        return;
      }

      await openTargetUrl(targetUrl, nextDeviceSettings);
    },
    [openTargetUrl, resolvedDraft]
  );

  const open = async (event: FormEvent) => {
    event.preventDefault();
    await submitCurrentUrl(url);
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitCurrentUrl(event.currentTarget.value);
  };

  const rotateDevice = () => {
    setError(null);
    const nextDraft = rotateDraft(draft);
    setDraft(nextDraft);
    void commitDeviceSettings(nextDraft);
  };

  return (
    <section className="dev-browser-surface" aria-label={t("dev_browser.title")}>
      <form className="dev-browser-toolbar" onSubmit={open}>
        <button
          aria-hidden="true"
          className="dev-browser-toolbar__implicit-submit"
          tabIndex={-1}
          type="submit"
        />
        <div className="dev-browser-toolbar__row">
          <div className="dev-browser-toolbar__field dev-browser-toolbar__field--url">
            <input
              aria-label={t("dev_browser.url_label")}
              className="dev-browser-toolbar__control dev-browser-toolbar__control--text"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={submitOnEnter}
              placeholder={t("dev_browser.url_placeholder")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div
            className={[
              "dev-browser-toolbar__device-strip",
              draft.devicePreset === "desktop" ? "dev-browser-toolbar__device-strip--desktop" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="dev-browser-toolbar__select-shell">
              <Select
                aria-label={t("dev_browser.device_label")}
                className="dev-browser-toolbar__select-trigger"
                options={deviceOptions}
                value={draft.devicePreset}
                desktopMode="listbox"
                mobileSheetTitle={t("dev_browser.device_label")}
                size="sm"
                onValueChange={(nextValue) => {
                  const nextDraft = synchronizeDraftWithPreset(draft, nextValue);
                  setDraft(nextDraft);
                  if (nextValue !== "custom") {
                    void commitDeviceSettings(nextDraft);
                  }
                }}
              />
            </div>
            {draft.devicePreset !== "desktop" ? (
              <div className="dev-browser-toolbar__dimensions">
                <input
                  className="dev-browser-toolbar__control dev-browser-toolbar__control--dimension"
                  aria-label={t("dev_browser.viewport_width_label")}
                  inputMode="numeric"
                  value={draft.viewportWidthInput}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      devicePreset: "custom",
                      viewportWidthInput: event.target.value,
                    }))
                  }
                />
                <span className="dev-browser-toolbar__dimension-separator" aria-hidden="true">
                  ×
                </span>
                <input
                  className="dev-browser-toolbar__control dev-browser-toolbar__control--dimension"
                  aria-label={t("dev_browser.viewport_height_label")}
                  inputMode="numeric"
                  value={draft.viewportHeightInput}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      devicePreset: "custom",
                      viewportHeightInput: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            {draft.devicePreset !== "desktop" ? (
              <button
                className="dev-browser-toolbar__button dev-browser-toolbar__button--icon"
                type="button"
                onClick={rotateDevice}
                aria-label={t("dev_browser.rotate")}
              >
                <RotateCw size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {!serviceWorkerSupported ? (
        <Notice tone="warning" message={t("dev_browser.unsupported")} />
      ) : null}
      {error ? (
        <Notice
          tone="error"
          message={error === "dev_browser_invalid_viewport" ? t(error) : t("dev_browser.error")}
        />
      ) : null}

      <div className="dev-browser-frame-shell" ref={frameShellRef}>
        {session ? (
          hasFixedViewport ? (
            <div
              className="dev-browser-frame-viewport dev-browser-frame-viewport--device"
              aria-label={t("dev_browser.viewport_preview_label")}
              style={{
                width: `${viewportWidth}px`,
                height: `${viewportHeight}px`,
                transform: `scale(${frameScale})`,
              }}
            >
              <iframe
                className="dev-browser-frame"
                title={t("dev_browser.title")}
                src={session.browserUrl}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                style={{
                  width: `${viewportWidth}px`,
                  height: `${viewportHeight}px`,
                }}
              />
            </div>
          ) : (
            <div
              className="dev-browser-frame-viewport"
              aria-label={t("dev_browser.viewport_preview_label")}
            >
              <iframe
                className="dev-browser-frame"
                title={t("dev_browser.title")}
                src={session.browserUrl}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
              />
            </div>
          )
        ) : (
          <EmptyState
            className="dev-browser-empty"
            title={<p>{t("dev_browser.title")}</p>}
            description={<p>{t("dev_browser.empty_description")}</p>}
          />
        )}
      </div>
    </section>
  );
}
