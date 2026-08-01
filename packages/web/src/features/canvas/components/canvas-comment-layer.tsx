import type { CanvasAnchorCommentDocument } from "@coder-studio/core";

interface CanvasCommentLayerProps {
  document: CanvasAnchorCommentDocument;
}

function getCommentPosition(comment: CanvasAnchorCommentDocument["comments"][number]) {
  const selectionRect = comment.selectionRect ??
    comment.targets?.[0]?.rect ?? { x: 0, y: 0, width: 0, height: 0 };

  return {
    left: selectionRect.x + selectionRect.width + 8,
    top: Math.max(0, selectionRect.y - 4),
  };
}

export function CanvasCommentLayer({ document }: CanvasCommentLayerProps) {
  if (document.comments.length === 0) {
    return null;
  }

  return (
    <div className="canvas-comment-layer" data-testid="canvas-comment-layer">
      {document.comments.map((comment) => {
        const position = getCommentPosition(comment);

        return (
          <article
            className={`canvas-comment-layer__item${
              comment.status === "resolved" ? " canvas-comment-layer__item--resolved" : ""
            }`}
            data-testid={`canvas-comment-${comment.id}`}
            key={comment.id}
            style={{ left: `${position.left}px`, top: `${position.top}px` }}
          >
            <p className="canvas-comment-layer__body">{comment.body}</p>
          </article>
        );
      })}
    </div>
  );
}
