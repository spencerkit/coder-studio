/**
 * ImagePreview — renders a workspace image inside the code-editor body.
 *
 * Sits inside the same `.code-editor-body` chrome that Monaco uses, so the
 * surrounding frame (header, border, shadow) matches the Git Diff viewer
 * and the text editor. The image itself is loaded via the `/api/file`
 * HTTP endpoint so large images don't have to travel over the WS channel.
 */

import type { FC } from 'react';
import { useEffect, useState } from 'react';

interface ImagePreviewProps {
  url: string;
  mime: string;
  sizeBytes: number;
  alt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mimeToLabel(mime: string): string {
  // "image/png" → "PNG", "image/svg+xml" → "SVG", "image/x-icon" → "ICO"
  const sub = mime.split('/')[1] ?? mime;
  const head = sub.split('+')[0].replace(/^x-/, '');
  return head.toUpperCase();
}

export const ImagePreview: FC<ImagePreviewProps> = ({ url, mime, sizeBytes, alt }) => {
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    // Reset when the underlying image changes so stale dimensions from the
    // previous file don't get shown for a frame.
    setDimensions(null);
    setErrored(false);
  }, [url]);

  return (
    <div className="image-preview">
      <div className="image-preview-canvas">
        {errored ? (
          <div className="git-diff-empty">
            <p className="git-diff-empty-title">Preview unavailable</p>
            <p className="git-diff-empty-body">
              The image could not be loaded. The file may have been moved or
              is larger than the browser allows.
            </p>
          </div>
        ) : (
          <img
            className="image-preview-img"
            src={url}
            alt={alt}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setErrored(true)}
          />
        )}
      </div>
      <div className="image-preview-meta">
        <span className="image-preview-type">{mimeToLabel(mime)}</span>
        {dimensions && (
          <span className="image-preview-dim">
            {dimensions.w} × {dimensions.h}
          </span>
        )}
        <span className="image-preview-size">{formatBytes(sizeBytes)}</span>
      </div>
    </div>
  );
};

export default ImagePreview;
