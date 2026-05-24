import type { FC } from "react";
import { EmptyState } from "../../../components/ui";

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

function ImageDiffPane({ label, url, alt }: { label: string; url?: string; alt: string }) {
  return (
    <section className="image-diff-preview__pane">
      <header className="image-diff-preview__pane-header">
        <span>{label}</span>
      </header>
      <div className="image-diff-preview__canvas">
        {url ? (
          <img className="image-diff-preview__image" src={url} alt={alt} draggable={false} />
        ) : (
          <EmptyState
            className="git-diff-empty"
            title={<p className="git-diff-empty-title">No image</p>}
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
        <ImageDiffPane label="Base" url={beforeUrl} alt={`${path} base`} />
        <ImageDiffPane label="Current" url={afterUrl} alt={`${path} current`} />
      </div>
    </div>
  );
};

export default ImageDiffPreview;
