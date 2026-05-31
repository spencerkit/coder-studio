import type { FC } from "react";
import { useEffect, useState } from "react";
import { Button, EmptyState } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

interface ImageDiffPreviewProps {
  path: string;
  mime: string;
  status: "modified" | "added" | "deleted";
  beforeUrl?: string;
  afterUrl?: string;
}

function imageLabel(mime: string): string {
  const suffix = mime.split("/")[1] ?? mime;
  const head = suffix.split("+")[0] ?? suffix;
  return head.replace(/^x-/, "").toUpperCase();
}

function ImageDiffPane({
  label,
  emptyTitle,
  url,
  alt,
}: {
  label: string;
  emptyTitle: string;
  url?: string;
  alt: string;
}) {
  const t = useTranslation();
  const [errored, setErrored] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setErrored(false);
    setReloadKey(0);
  }, [url]);

  return (
    <section className="image-diff-preview__pane">
      <header className="image-diff-preview__pane-header">
        <span>{label}</span>
      </header>
      <div className="image-diff-preview__canvas">
        {!url ? (
          <EmptyState
            className="git-diff-empty"
            title={<p className="git-diff-empty-title">{emptyTitle}</p>}
          />
        ) : errored ? (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  setErrored(false);
                  setReloadKey((current) => current + 1);
                }}
                size="sm"
                variant="ghost"
              >
                {t("code_editor.preview_retry")}
              </Button>
            }
            className="git-diff-empty"
            description={
              <p className="git-diff-empty-body">{t("code_editor.image_load_failed_body")}</p>
            }
            title={<p className="git-diff-empty-title">{t("code_editor.preview_unavailable")}</p>}
          />
        ) : (
          <img
            className="image-diff-preview__image"
            key={`${url}:${reloadKey}`}
            src={url}
            alt={alt}
            draggable={false}
            onError={() => setErrored(true)}
          />
        )}
      </div>
    </section>
  );
}

export const ImageDiffPreview: FC<ImageDiffPreviewProps> = ({
  path,
  mime,
  status,
  beforeUrl,
  afterUrl,
}) => {
  const t = useTranslation();

  return (
    <div className="image-diff-preview" data-testid="image-diff-preview">
      <div className="image-diff-preview__meta">
        <span>{path}</span>
        <span>{imageLabel(mime)}</span>
        <span>{status}</span>
      </div>
      <div className="image-diff-preview__stack">
        <ImageDiffPane
          label={t("code_editor.image_diff_base")}
          emptyTitle={t("code_editor.image_diff_no_base")}
          url={beforeUrl}
          alt={`${path} ${t("code_editor.image_diff_base")}`}
        />
        <ImageDiffPane
          label={t("code_editor.image_diff_current")}
          emptyTitle={t("code_editor.image_diff_no_current")}
          url={afterUrl}
          alt={`${path} ${t("code_editor.image_diff_current")}`}
        />
      </div>
    </div>
  );
};

export default ImageDiffPreview;
