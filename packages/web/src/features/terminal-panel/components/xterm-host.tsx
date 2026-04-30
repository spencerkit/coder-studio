/**
 * XtermHost Component
 *
 * Renders xterm.js terminal with:
 * - FitAddon for responsive sizing
 * - WebSocket event subscription for output
 * - User input dispatch to server
 * - Aurora Mint theme that follows the current UI mode
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { wsClientAtom } from '../../../atoms/connection';
import { terminalOutputAtomFamily, terminalMetaAtomFamily } from '../../../atoms/terminals';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { themeAtom } from '../../../atoms/ui';
import { Topics } from '@coder-studio/core';
import type { OutputBuffer } from '../../../atoms/terminals';
import type { TerminalBinaryPayload, TerminalReplayPayload } from '../../../ws/client';

type TerminalInputActivity = 'typing' | 'submit' | 'system';

interface TerminalInputDraftState {
  nextDraft: string;
  submittedText?: string;
}

function classifyTerminalInput(data: string): TerminalInputActivity {
  if (data === '\x1b[I' || data === '\x1b[O') {
    return 'system';
  }

  if (data.includes('\r') || data.includes('\n')) {
    return 'submit';
  }

  return 'typing';
}

function consumeTerminalInputDraft(
  draft: string,
  data: string,
  activity: TerminalInputActivity
): TerminalInputDraftState {
  if (activity === 'system') {
    return { nextDraft: draft };
  }

  let nextDraft = draft;
  let submittedText: string | undefined;

  for (let index = 0; index < data.length; index += 1) {
    const char = data[index]!;

    if (char === '\x1b') {
      const remaining = data.slice(index);
      const escapeMatch = remaining.match(/^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)/);
      if (escapeMatch) {
        index += escapeMatch[0].length - 1;
        continue;
      }
    }

    if (char === '\u007f' || char === '\b') {
      nextDraft = nextDraft.slice(0, -1);
      continue;
    }

    if (char === '\u0015') {
      nextDraft = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      submittedText = nextDraft.length > 0 ? nextDraft : submittedText;
      nextDraft = '';
      continue;
    }

    if (char >= ' ') {
      nextDraft += char;
    }
  }

  return { nextDraft, submittedText };
}

/**
 * Aurora Mint terminal themes for xterm.js.
 * These mirror the light/dark tokens so terminals stay legible when the user
 * switches themes without needing a full remount.
 */
const AURORA_MINT_THEMES = {
  dark: {
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
  },
  light: {
    background: '#fafbfc',
    foreground: '#1f2328',
    cursor: '#0969da',
    cursorAccent: '#fafbfc',
    selectionBackground: '#dde4ea',
    selectionForeground: '#1f2328',
    black: '#24292f',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#57606a',
    brightBlack: '#8b949e',
    brightRed: '#cf222e',
    brightGreen: '#1a7f37',
    brightYellow: '#9a6700',
    brightBlue: '#0969da',
    brightMagenta: '#8250df',
    brightCyan: '#1b7c83',
    brightWhite: '#1f2328',
  },
};

function getTerminalTheme(theme: 'dark' | 'light') {
  return AURORA_MINT_THEMES[theme];
}

const terminalInputEncoder = new TextEncoder();

export function trimWrittenChunks(buffer: OutputBuffer, writtenChunkCount: number): OutputBuffer {
  const removeCount = Math.min(writtenChunkCount, buffer.chunks.length);
  if (removeCount === 0) {
    return buffer;
  }

  return {
    ...buffer,
    chunks: buffer.chunks.slice(removeCount),
    lastWritten: 0,
  };
}

interface XtermHostProps {
  /** Terminal ID */
  terminalId: string;
  /** Workspace ID for topic subscription */
  workspaceId: string;
  /** Prevent stdin dispatch for historical or ended terminals */
  readOnly?: boolean;
  /** Container element ref for sizing */
  containerRef?: React.RefObject<HTMLDivElement>;
}

interface ReplayPayload {
  status: 'ok' | 'too_old' | 'unknown';
  transport?: 'binary';
  streamId?: number;
  size?: number;
  seq?: number;
  bytes?: Uint8Array;
}

/**
 * XtermHost renders an xterm.js terminal instance
 *
 * Lifecycle:
 * 1. Mount: create Terminal, attach FitAddon, subscribe to events
 * 2. Update: write new output chunks from atom, fit on resize
 * 3. Unmount: dispose Terminal, unsubscribe from events
 */
export function XtermHost({ terminalId, workspaceId, readOnly = false }: XtermHostProps) {
  const uiTheme = useAtomValue(themeAtom);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const fitResolversRef = useRef<Array<() => void>>([]);
  const interactiveRef = useRef(true);
  const lastReportedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  // Buffer WS output chunks that arrive before the replay response resolves,
  // so we can reconcile them against the replay snapshot instead of writing
  // the overlapping bytes twice into xterm.
  const pendingReplayChunksRef = useRef<Array<{ bytes: Uint8Array; seq: number }>>([]);
  const replayCompletedRef = useRef(false);
  const replayedSeqRef = useRef(0);
  const initialThemeRef = useRef(uiTheme);
  const inputDraftRef = useRef('');

  const wsClient = useAtomValue(wsClientAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [outputAtom, setOutputAtom] = useAtom(terminalOutputAtomFamily(terminalId));
  const meta = useAtomValue(terminalMetaAtomFamily(terminalId));
  const isInteractive = !readOnly && meta?.alive !== false;

  // Latest copies of callback identities used inside the mount effect, exposed
  // via refs so the effect's cleanup/re-creation is not tied to their churn.
  const handleInputRef = useRef<(data: string) => void | Promise<void>>(() => {});
  const handleResizeRef = useRef<(size: { cols: number; rows: number }) => void | Promise<void>>(
    () => {}
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    interactiveRef.current = isInteractive;

    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = !isInteractive;
      terminalRef.current.options.cursorBlink = isInteractive;
    }
  }, [isInteractive]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTerminalTheme(uiTheme);
    }
  }, [uiTheme]);

  const scheduleFit = useCallback(() => {
    if (fitFrameRef.current !== null) {
      cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;

      try {
        fitAddonRef.current?.fit();
      } catch (error) {
        console.error('Failed to fit xterm instance:', error);
      } finally {
        const resolvers = fitResolversRef.current;
        fitResolversRef.current = [];
        for (const resolve of resolvers) {
          resolve();
        }
      }
    });
  }, []);

  const waitForNextFit = useCallback(() => {
    return new Promise<void>((resolve) => {
      fitResolversRef.current.push(resolve);
    });
  }, []);

  /**
   * Handle user input - dispatch to server
   */
  const handleInput = useCallback(
    async (data: string) => {
      if (!interactiveRef.current) {
        return;
      }

      if (!wsClient) {
        console.error('Cannot send terminal input: WebSocket not connected');
        return;
      }

      try {
        const activity = classifyTerminalInput(data);
        const { nextDraft, submittedText } = consumeTerminalInputDraft(
          inputDraftRef.current,
          data,
          activity
        );
        inputDraftRef.current = nextDraft;

        await wsClient.sendTerminalInput(
          terminalId,
          terminalInputEncoder.encode(data),
          activity,
          submittedText
        );
      } catch (error) {
        console.error('Failed to send terminal input:', error);
      }
    },
    [terminalId, wsClient]
  );

  const handleResize = useCallback(
    async ({ cols, rows }: { cols: number; rows: number }) => {
      if (!interactiveRef.current) {
        return;
      }

      const previousSize = lastReportedSizeRef.current;
      if (previousSize && previousSize.cols === cols && previousSize.rows === rows) {
        return;
      }

      lastReportedSizeRef.current = { cols, rows };

      const result = await dispatch('terminal.resize', {
        terminalId,
        cols,
        rows,
      });

      if (!result.ok) {
        console.error('Failed to sync terminal size:', result.error);
      }
    },
    [terminalId, dispatch]
  );

  // Keep callback refs in sync so the mount effect can call the latest version
  // without listing the callbacks as dependencies.
  useEffect(() => {
    handleInputRef.current = handleInput;
  }, [handleInput]);

  useEffect(() => {
    handleResizeRef.current = handleResize;
  }, [handleResize]);

  /**
   * Initialize terminal on mount.
   *
   * Deliberately scoped to (terminalId, workspaceId, wsClient): we do NOT
   * re-create the xterm instance when isInteractive, handleInput/handleResize,
   * scheduleFit, or setOutputAtom churn — those are consumed via refs. Tearing
   * down the Terminal means losing every rendered row and re-running the
   * replay, which used to amplify "blank line" artifacts on benign renders.
   */
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let unsubscribeStatus: (() => void) | null = null;

    replayCompletedRef.current = false;
    replayedSeqRef.current = 0;
    pendingReplayChunksRef.current = [];
    lastReportedSizeRef.current = null;

    // Create Terminal instance.
    // lineHeight is left at xterm.js default (1.0) so that box-drawing
    // characters used by TUIs (claude, codex) render as a continuous frame
    // with no gaps between rows.
    const terminal = new Terminal({
      theme: getTerminalTheme(initialThemeRef.current),
      fontFamily: 'JetBrains Mono, Fira Code, SF Mono, monospace',
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: interactiveRef.current,
      cursorStyle: 'block',
      disableStdin: !interactiveRef.current,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.onResize((size) => {
      void handleResizeRef.current(size);
    });
    terminal.onData((data) => {
      void handleInputRef.current(data);
    });

    terminal.open(containerRef.current);
    // Defer the first fit to the next frame so flex layout has settled;
    // calling fit() synchronously right after open() sometimes runs against a
    // zero- or partial-height container and produces an off-by-one row count
    // whose leftover pixels render as a blank strip.
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    scheduleFit();
    const initialFitReady = waitForNextFit();

    const waitForConnected = async () => {
      if (!wsClient) {
        return;
      }

      if (typeof wsClient.getStatus !== 'function' || typeof wsClient.onStatus !== 'function') {
        return;
      }

      if (wsClient.getStatus() === 'connected') {
        return;
      }

      await new Promise<void>((resolve) => {
        unsubscribeStatus = wsClient.onStatus((status) => {
          if (status === 'connected') {
            unsubscribeStatus?.();
            unsubscribeStatus = null;
            resolve();
          }
        });
      });
    };

    const initialReplayReady = initialFitReady.then(async () => {
      await waitForConnected();
      if (disposed || !mountedRef.current) {
        return;
      }

      const { cols, rows } = terminal;
      await handleResizeRef.current({ cols, rows });
    });

    const outputTopic = Topics.terminalOutput(workspaceId, terminalId);
    const exitTopic = Topics.terminalExit(workspaceId, terminalId);

    const flushPendingReplayChunks = (coveredSeq: number) => {
      const pending = pendingReplayChunksRef.current;
      pendingReplayChunksRef.current = [];

      let latestCoveredSeq = coveredSeq;
      for (const entry of pending) {
        if (entry.seq <= latestCoveredSeq) {
          continue;
        }

        terminal.write(entry.bytes);
        latestCoveredSeq = entry.seq;
      }

      replayedSeqRef.current = latestCoveredSeq;
    };

    const finishReplay = (result: { ok: boolean; data?: ReplayPayload; error?: unknown } | null) => {
      if (!mountedRef.current || !terminalRef.current || !result) {
        return;
      }

      let coveredSeq = replayedSeqRef.current;
      if (result.ok && result.data?.status === 'ok') {
        if (result.data.bytes) {
          terminal.write(result.data.bytes);
        }
        coveredSeq = result.data.seq ?? coveredSeq;
      } else if (result.data?.status === 'too_old') {
        // Ring buffer overflow - show a message to the user
        if (terminalRef.current) {
          terminalRef.current.writeln('\r\n\x1b[33m[Session history truncated - output exceeds buffer size]\x1b[0m');
        }
      } else if (!result.ok) {
        console.error('Failed to replay terminal output:', result.error);
      }

      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [],
        lastSeq: Math.max(prev.lastSeq, coveredSeq),
        lastWritten: 0,
      }));

      replayedSeqRef.current = coveredSeq;
      replayCompletedRef.current = true;
      flushPendingReplayChunks(coveredSeq);
    };

    const failReplay = (error: unknown) => {
      console.error('Failed to replay terminal output:', error);
      if (!mountedRef.current || !terminalRef.current) {
        return;
      }

      setOutputAtom((prev: OutputBuffer) => ({
        ...prev,
        chunks: [],
        lastWritten: 0,
      }));

      replayCompletedRef.current = true;
      flushPendingReplayChunks(replayedSeqRef.current);
    };

    const requestReplay = (lastSeq: number) => {
      replayCompletedRef.current = false;
      void dispatch<ReplayPayload>('terminal.replay', {
        terminalId,
        lastSeq,
      })
        .then((result) => {
          finishReplay(result);
        })
        .catch((error) => {
          failReplay(error);
        });
    };

    if (wsClient) {
      unsubscribeRef.current = wsClient.subscribe(
        [outputTopic, exitTopic],
        (topic, payload, _seq) => {
          if (topic === outputTopic) {
            const outputData = payload as TerminalBinaryPayload;

            if (!replayCompletedRef.current) {
              pendingReplayChunksRef.current.push({
                bytes: outputData.bytes,
                seq: _seq,
              });
              return;
            }

            if (_seq <= replayedSeqRef.current) {
              return;
            }

            const chunkStartSeq = _seq - outputData.bytes.byteLength;
            if (chunkStartSeq > replayedSeqRef.current) {
              pendingReplayChunksRef.current.push({
                bytes: outputData.bytes,
                seq: _seq,
              });
              setOutputAtom((_prev: OutputBuffer) => ({
                chunks: [],
                lastSeq: replayedSeqRef.current,
                lastWritten: 0,
              }));
              requestReplay(replayedSeqRef.current);
              return;
            }

            setOutputAtom((prev: OutputBuffer) => {
              if (_seq <= prev.lastSeq) return prev;
              return {
                chunks: [...prev.chunks, outputData.bytes],
                lastSeq: _seq,
                lastWritten: prev.lastWritten,
              };
            });
            // Advance replayedSeqRef so subsequent contiguous chunks don't
            // trip the gap-detection branch above and trigger spurious replays
            // that re-write bytes already painted via the live path.
            replayedSeqRef.current = _seq;
          } else if (topic === exitTopic) {
            const exitData = payload as { code: number };
            if (terminalRef.current) {
              terminalRef.current.writeln(`\r\n[Process exited with code ${exitData.code}]`);
            }
          }
        }
      );
    }

    (async () => {
      await initialReplayReady;
      if (!mountedRef.current) {
        return;
      }

      requestReplay(0);
    })().catch((error) => {
      failReplay(error);
    });

    return () => {
      disposed = true;
      if (unsubscribeStatus) {
        unsubscribeStatus();
        unsubscribeStatus = null;
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      if (terminalRef.current) {
        try {
          terminalRef.current.dispose();
        } catch (error) {
          console.error('Failed to dispose xterm instance:', error);
        }
        terminalRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [terminalId, workspaceId, wsClient, dispatch, scheduleFit, setOutputAtom]);

  /**
   * Write new output chunks to terminal
   */
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const { chunks, lastWritten } = outputAtom;
    const writtenChunkCount = chunks.length - lastWritten;

    if (writtenChunkCount > 0) {
      // Write any unwritten chunks
      for (let i = lastWritten; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;

        terminal.write(chunk);
      }

      // Update lastWritten to prevent atom bloat
      setOutputAtom((prev: OutputBuffer) => trimWrittenChunks(prev, writtenChunkCount));
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
      scheduleFit();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scheduleFit]);

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
