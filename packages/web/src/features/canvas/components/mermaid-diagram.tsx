import { useEffect, useId, useRef, useState } from "react";

const MERMAID_SCRIPT_SRC = "/api/preview/assets/mermaid.min.js";

type MermaidRuntime = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    source: string
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

declare global {
  interface Window {
    mermaid?: MermaidRuntime;
  }
}

let mermaidLoader: Promise<MermaidRuntime> | null = null;

export function loadMermaidRuntime(): Promise<MermaidRuntime> {
  if (mermaidLoader) {
    return mermaidLoader;
  }

  mermaidLoader = new Promise((resolve, reject) => {
    if (window.mermaid) {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      resolve(window.mermaid);
      return;
    }

    const script = document.createElement("script");
    script.src = MERMAID_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      if (!window.mermaid) {
        mermaidLoader = null;
        reject(new Error("Mermaid runtime failed to initialize."));
        return;
      }

      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      resolve(window.mermaid);
    };
    script.onerror = () => {
      mermaidLoader = null;
      reject(new Error("Failed to load Mermaid runtime."));
    };
    document.head.appendChild(script);
  });

  return mermaidLoader;
}

export function resetMermaidRuntimeForTests(): void {
  mermaidLoader = null;
  delete window.mermaid;
}

interface MermaidDiagramProps {
  source: string;
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;
    container.replaceChildren();
    setError(null);

    void loadMermaidRuntime()
      .then(async (mermaid) => {
        const id = `mermaid-${renderId}`;
        const { svg, bindFunctions } = await mermaid.render(id, source);
        if (cancelled) {
          return;
        }

        container.innerHTML = svg;
        bindFunctions?.(container);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        container.replaceChildren();
        setError(nextError instanceof Error ? nextError.message : "Failed to render diagram.");
      });

    return () => {
      cancelled = true;
    };
  }, [renderId, source]);

  if (error) {
    return (
      <p style={{ margin: 0, color: "#7f1d1d", lineHeight: 1.6 }}>
        Mermaid diagram failed to render: {error}
      </p>
    );
  }

  return <div ref={containerRef} className="architecture-canvas-mermaid" />;
}
