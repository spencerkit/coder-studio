/**
 * XtermHost Component
 *
 * Renders xterm.js terminal with:
 * - FitAddon for responsive sizing
 * - WebSocket event subscription for output
 * - User input dispatch to server
 * - Aurora Mint dark theme
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { wsClientAtom } from '../../../atoms/connection';
import { terminalOutputAtomFamily, terminalMetaAtomFamily } from '../../../atoms/terminals';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { Topics } from '@coder-studio/core';
import type { OutputBuffer } from '../../../atoms/terminals';

/**
 * Aurora Mint theme for xterm.js
 * Matches design tokens from tokens.css
 */
const AURORA_MINT_THEME = {
  background: '#0b1218',
  foreground: '#e5edf3',
  cursor: '#78d7b2',
  cursorAccent: '#0b1218',
  selectionBackground: '#1e3040',
  selectionForeground: '#e5edf3',
  black: '#0a1014',
  red: '#ff9eb0',
  green: '#78d7b2',
  yellow: '#f1b86a',
  blue: '#6cb6ff',
  magenta: '#c792ea',
  cyan: '#78d7b2',
  white: '#9fb0bc',
  brightBlack: '#4a5b6a',
  brightRed: '#ff9eb0',
  brightGreen: '#78d7b2',
  brightYellow: '#f1b86a',
  brightBlue: '#6cb6ff',
  brightMagenta: '#c792ea',
  brightCyan: '#78d7b2',
  brightWhite: '#e5edf3',
};

interface XtermHostProps {
  /** Terminal ID */
  terminalId: string;
  /** Workspace ID for topic subscription */
  workspaceId: string;
  /** Container element ref for sizing */
  containerRef?: React.RefObject<HTMLDivElement>;
}

/**
 * XtermHost renders an xterm.js terminal instance
 *
 * Lifecycle:
 * 1. Mount: create Terminal, attach FitAddon, subscribe to events
 * 2. Update: write new output chunks from atom, fit on resize
 * 3. Unmount: dispose Terminal, unsubscribe from events
 */
export function XtermHost({ terminalId, workspaceId }: XtermHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const wsClient = useAtomValue(wsClientAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [outputAtom, setOutputAtom] = useAtom(terminalOutputAtomFamily(terminalId));
  const meta = useAtomValue(terminalMetaAtomFamily(terminalId));

  /**
   * Handle user input - dispatch to server
   */
  const handleInput = useCallback(
    async (data: string) => {
      const result = await dispatch('terminal.input', {
        terminalId,
        bytes: btoa(data), // Base64 encode for binary-safe transport
      });

      if (!result.ok) {
        console.error('Failed to send terminal input:', result.error);
      }
    },
    [terminalId, dispatch]
  );

  /**
   * Ensure terminal meta is initialized on mount if not yet set by WS event.
   * This handles the case where XtermHost mounts before the terminal.created event arrives.
   */
  useEffect(() => {
    if (!meta) {
      // Set a minimal meta so the terminal knows its own identity
      // The full meta will be populated when terminal.created WS event arrives
      setOutputAtom((prev: OutputBuffer) => prev); // trigger no-op to ensure atom is initialized
    }
  }, [meta, setOutputAtom]);

  /**
   * Initialize terminal on mount
   */
  useEffect(() => {
    if (!containerRef.current) return;

    // Create Terminal instance
    const terminal = new Terminal({
      theme: AURORA_MINT_THEME,
      fontFamily: 'JetBrains Mono, Fira Code, SF Mono, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 5000,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
    });

    // Create FitAddon
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Try WebGL renderer for better performance
    if (containerRef.current) {
      try {
        const webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
      } catch {
        // WebGL not supported, fallback to canvas
      }
    }

    // Open terminal in container
    terminal.open(containerRef.current);
    fitAddon.fit();

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle user input
    terminal.onData(handleInput);

    // Subscribe to terminal output events
    const outputTopic = Topics.terminalOutput(workspaceId, terminalId);
    const exitTopic = Topics.terminalExit(workspaceId, terminalId);

    if (wsClient) {
      unsubscribeRef.current = wsClient.subscribe(
        [outputTopic, exitTopic],
        (topic, payload, _seq) => {
          if (topic === outputTopic) {
            // Output event: append to atom
            // Server sends { chunk: base64, size, seq }
            const outputData = payload as { chunk: string; size: number; seq: number };
            setOutputAtom((prev: OutputBuffer) => ({
              chunks: [...prev.chunks, outputData.chunk],
              lastSeq: outputData.seq,
              lastWritten: prev.lastWritten,
            }));
          } else if (topic === exitTopic) {
            // Exit event: terminal closed
            const exitData = payload as { code: number };
            if (terminalRef.current) {
              terminalRef.current.writeln(`\r\n[Process exited with code ${exitData.code}]`);
            }
          }
        }
      );
    }

    // Cleanup on unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [terminalId, workspaceId, wsClient, handleInput, setOutputAtom]);

  /**
   * Write new output chunks to terminal
   */
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const { chunks, lastWritten } = outputAtom;

    // Write any unwritten chunks
    for (let i = lastWritten; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      try {
        const decoded = atob(chunk);
        terminal.write(decoded);
      } catch {
        // If decode fails, write raw
        terminal.write(chunk);
      }
    }

    // Update lastWritten to prevent atom bloat
    if (chunks.length > lastWritten) {
      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [], // Clear chunks after writing
        lastWritten: 0,
      }));
    }
  }, [outputAtom, setOutputAtom]);

  /**
   * Fit terminal on container resize
   * Uses ResizeObserver for responsive sizing
   */
  useEffect(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !fitAddon) return;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  /**
   * Focus terminal when it becomes active
   */
  useEffect(() => {
    if (meta?.alive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [meta?.alive]);

  return (
    <div
      ref={containerRef}
      className="xterm-host"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
}

export default XtermHost;