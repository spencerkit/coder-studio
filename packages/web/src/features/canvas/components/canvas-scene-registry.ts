import type {
  CanvasSceneElement,
  CanvasSceneElementKind,
  CanvasSceneManifest,
  CanvasSceneRect,
} from "@coder-studio/core";
import {
  type CSSProperties,
  createElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";

interface RegisterDomElementInput {
  id: string;
  kind: CanvasSceneElementKind;
  node: HTMLElement | null;
  sceneRoot: HTMLElement | null;
  label?: string;
  payload?: Record<string, unknown>;
}

type SceneManifestListener = (manifest: CanvasSceneManifest) => void;

export interface CanvasSceneRegistry {
  clear(): void;
  getManifest(): CanvasSceneManifest;
  registerDomElement(input: RegisterDomElementInput): void;
  subscribe(listener: SceneManifestListener): () => void;
  upsertElement(element: CanvasSceneElement): void;
  unregisterElement(id: string): void;
}

function normalizeRect(node: HTMLElement, sceneRoot: HTMLElement): CanvasSceneRect {
  const nodeRect = node.getBoundingClientRect();
  const rootRect = sceneRoot.getBoundingClientRect();

  return {
    x: nodeRect.left - rootRect.left,
    y: nodeRect.top - rootRect.top,
    width: nodeRect.width,
    height: nodeRect.height,
  };
}

function createManifest(elements: Map<string, CanvasSceneElement>): CanvasSceneManifest {
  return {
    version: 1,
    elements: [...elements.values()],
  };
}

export function createCanvasSceneRegistry(): CanvasSceneRegistry {
  const listeners = new Set<SceneManifestListener>();
  const elements = new Map<string, CanvasSceneElement>();

  const notify = () => {
    const manifest = createManifest(elements);
    listeners.forEach((listener) => {
      listener(manifest);
    });
  };

  return {
    clear() {
      if (elements.size === 0) {
        return;
      }

      elements.clear();
      notify();
    },
    getManifest() {
      return createManifest(elements);
    },
    registerDomElement(input) {
      if (!input.node || !input.sceneRoot) {
        this.unregisterElement(input.id);
        return;
      }

      const nextElement: CanvasSceneElement = {
        id: input.id,
        kind: input.kind,
        rect: normalizeRect(input.node, input.sceneRoot),
        ...(input.label ? { label: input.label } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      };
      const previous = elements.get(input.id);

      if (previous && JSON.stringify(previous) === JSON.stringify(nextElement)) {
        return;
      }

      elements.set(input.id, nextElement);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(createManifest(elements));
      return () => {
        listeners.delete(listener);
      };
    },
    upsertElement(element) {
      const previous = elements.get(element.id);
      if (previous && JSON.stringify(previous) === JSON.stringify(element)) {
        return;
      }

      elements.set(element.id, element);
      notify();
    },
    unregisterElement(id) {
      if (!elements.delete(id)) {
        return;
      }

      notify();
    },
  };
}

interface UseCanvasSceneElementOptions {
  id: string;
  kind: CanvasSceneElementKind;
  label?: string;
  payload?: Record<string, unknown>;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
}

export function useCanvasSceneElement<T extends HTMLElement>({
  id,
  kind,
  label,
  payload,
  sceneRegistry,
  sceneRootRef,
}: UseCanvasSceneElementOptions) {
  const elementRef = useRef<T | null>(null);
  const payloadKey = JSON.stringify(payload ?? null);

  useEffect(() => {
    if (!sceneRegistry) {
      return;
    }

    sceneRegistry.registerDomElement({
      id,
      kind,
      node: elementRef.current,
      sceneRoot: sceneRootRef?.current ?? null,
      label,
      payload,
    });

    return () => {
      sceneRegistry.unregisterElement(id);
    };
  }, [id, kind, label, payloadKey, sceneRegistry, sceneRootRef]);

  return elementRef;
}

interface SceneBoxProps {
  as: "div" | "article" | "aside" | "td";
  children: ReactNode;
  id: string;
  kind: CanvasSceneElementKind;
  label?: string;
  payload?: Record<string, unknown>;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
  style?: CSSProperties;
  className?: string;
  colSpan?: number;
}

export function CanvasSceneBox({
  as,
  children,
  id,
  kind,
  label,
  payload,
  sceneRegistry,
  sceneRootRef,
  style,
  className,
  colSpan,
}: SceneBoxProps) {
  const elementRef = useCanvasSceneElement<HTMLElement>({
    id,
    kind,
    label,
    payload,
    sceneRegistry,
    sceneRootRef,
  });
  const Tag = as;

  return createElement(
    Tag,
    {
      className,
      "data-scene-id": id,
      ref: elementRef,
      style,
      ...(colSpan !== undefined ? { colSpan } : {}),
    },
    children
  );
}
