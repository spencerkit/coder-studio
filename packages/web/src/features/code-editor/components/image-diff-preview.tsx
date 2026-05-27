import type { FC } from "react";
import { useEffect, useState } from "react";
import { Button, EmptyState } from "../../../components/ui";

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
                Retry
              </Button>
            }
            className="git-diff-empty"
            description={
              <p className="git-diff-empty-body">
                The image could not be loaded. The file may have been moved or is larger than the
                browser allows.
              </p>
            }
            title={<p className="git-diff-empty-title">Preview unavailable</p>}
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
  return (
    <div className="image-diff-preview" data-testid="image-diff-preview">
      <div className="image-diff-preview__meta">
        <span>{path}</span>
        <span>{imageLabel(mime)}</span>
        <span>{status}</span>
      </div>
      <div className="image-diff-preview__stack">
        <ImageDiffPane
          label="Base"
          emptyTitle="No base image"
          url={beforeUrl}
          alt={`${path} base`}
        />
        <ImageDiffPane
          label="Current"
          emptyTitle="No current image"
          url={afterUrl}
          alt={`${path} current`}
        />
      </div>
    </div>
  );
};

export default ImageDiffPreview;
