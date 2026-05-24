import { type FC, useEffect, useRef, useState } from "react";
import { EmptyState } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

export const DocumentPreview: FC<{
  src: string | null;
  title: string;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
}> = ({ src, title, isLoading, error, onRetry }) => {
  const t = useTranslation();
  const [frameErrored, setFrameErrored] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setFrameErrored(false);
  }, [src]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const handleFrameError = () => {
      setFrameErrored(true);
    };

    frame.addEventListener("error", handleFrameError);
    return () => {
      frame.removeEventListener("error", handleFrameError);
    };
  }, [src]);

  if (isLoading) {
    return (
      <div className="document-preview document-preview--loading">
        {t("code_editor.preview_loading")}
      </div>
    );
  }

  if (error || frameErrored || !src) {
    return (
      <div className="document-preview">
        <EmptyState
          className="git-diff-empty"
          title={<p className="git-diff-empty-title">{t("code_editor.preview_unavailable")}</p>}
          action={
            onRetry ? (
              <button type="button" className="code-mode-btn" onClick={onRetry}>
                {t("code_editor.preview_retry")}
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="document-preview">
      <iframe
        ref={frameRef}
        className="document-preview-frame"
        title={`${title} preview`}
        src={src}
        sandbox=""
      />
    </div>
  );
};
