import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeAnsiTranscript } from "../apps/web/src/shared/utils/ansi-transcript";

test("sanitizeAnsiTranscript strips cursor control sequences across chunks", () => {
  assert.equal(
    sanitizeAnsiTranscript("hello\n\u001b[1A\u001b[2K\rworking"),
    "hello\nworking",
  );
});

test("sanitizeAnsiTranscript drops OSC sequences without leaking title bytes", () => {
  assert.equal(
    sanitizeAnsiTranscript("\u001b]0;agent title\u0007hello"),
    "hello",
  );
});

test("sanitizeAnsiTranscript turns bare carriage return updates into separate lines", () => {
  assert.equal(
    sanitizeAnsiTranscript("working\rworking.\rworking..\n"),
    "working\nworking.\nworking..\n",
  );
});

test("sanitizeAnsiTranscript preserves cursor forward spacing for word separated tui output", () => {
  assert.equal(
    sanitizeAnsiTranscript("\u001b[1CAccessing\u001b[1Cworkspace:\r\r\n"),
    " Accessing workspace:\n",
  );
  assert.equal(
    sanitizeAnsiTranscript("\u001b[1CQuick\u001b[1Csafety\u001b[1Ccheck:\u001b[1CIs\u001b[1Cthis\r\r\n"),
    " Quick safety check: Is this\n",
  );
});

test("sanitizeAnsiTranscript reconstructs absolute cursor layout into readable transcript lines", () => {
  assert.equal(
    sanitizeAnsiTranscript(
      "\u001b[2;1H  \u2728\u001b[2;5HUpdate available!\u001b[2;24H0.117.0 -> 0.118.0\u001b[4;3HRelease notes:\u001b[6;1H\u203a 1. Update now\u001b[7;3H2. Skip\u001b[10;3HPress enter to continue",
    ),
    "  \u2728 Update available!  0.117.0 -> 0.118.0\n\n  Release notes:\n\n\u203a 1. Update now\n  2. Skip\n\n\n  Press enter to continue",
  );
});

test("sanitizeAnsiTranscript reconstructs the codex trust prompt from raw terminal output", () => {
  const raw = [
    "\u001b[1;1H>",
    "\u001b[1;3H\u001b[1mYou are in \u001b[22m/tmp/demo",
    "\u001b[3;3HDo",
    "\u001b[3;6Hyou",
    "\u001b[3;10Htrust",
    "\u001b[3;16Hthe",
    "\u001b[3;20Hcontents",
    "\u001b[3;29Hof",
    "\u001b[3;32Hthis",
    "\u001b[3;37Hdirectory?",
    "\u001b[3;48HWorking",
    "\u001b[3;56Hwith",
    "\u001b[3;61Huntrusted",
    "\u001b[3;71Hcontents",
    "\u001b[3;80Hcomes",
    "\u001b[3;86Hwith",
    "\u001b[3;91Hhigher",
    "\u001b[3;98Hrisk",
    "\u001b[3;103Hof",
    "\u001b[3;106Hprompt",
    "\u001b[3;113Hinjection.",
    "\u001b[5;1H\u001b[;m\u203a 1. Yes, continue",
    "\u001b[6;3H\u001b[;m2.",
    "\u001b[6;6HNo,",
    "\u001b[6;10Hquit",
    "\u001b[8;3H\u001b[2mPress enter to continue\u001b[m",
  ].join("");

  assert.equal(
    sanitizeAnsiTranscript(raw),
    "> You are in /tmp/demo\n\n  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.\n\n\u203a 1. Yes, continue\n  2. No, quit\n\n  Press enter to continue",
  );
});
