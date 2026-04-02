type ParseState =
  | { kind: "text" }
  | { kind: "escape" }
  | { kind: "csi"; params: string }
  | { kind: "osc" }
  | { kind: "oscEscape" };

const parseCsiCount = (params: string, fallback: number) => (
  params
    .split(";")
    .map((part) => Number.parseInt(part.trim(), 10))
    .find((value) => Number.isFinite(value) && value > 0)
  ?? fallback
);

const parseCsiPosition = (params: string) => {
  const [rawRow, rawCol] = params.split(";", 2);
  const row = Number.parseInt(rawRow?.trim() ?? "", 10);
  const col = Number.parseInt(rawCol?.trim() ?? "", 10);
  return {
    row: Number.isFinite(row) && row > 0 ? row : 1,
    col: Number.isFinite(col) && col > 0 ? col : 1,
  };
};

export class AnsiTranscriptSanitizer {
  private state: ParseState = { kind: "text" };
  private lineHasOutput = false;
  private transcriptStarted = false;
  private blockBaseRow = 1;
  private emittedRow = 1;
  private emittedCol = 1;
  private cursorRow = 1;
  private cursorCol = 1;
  private pendingLineReset = false;
  private pendingBlockReset = false;
  private skipLineFeed = false;

  push(chunk: string) {
    if (!chunk) return "";

    let output = "";
    for (const char of chunk) {
      output = this.pushChar(char, output);
    }
    return output;
  }

  finish() {
    this.state = { kind: "text" };
    this.lineHasOutput = false;
    this.transcriptStarted = false;
    this.blockBaseRow = 1;
    this.emittedRow = 1;
    this.emittedCol = 1;
    this.cursorRow = 1;
    this.cursorCol = 1;
    this.pendingLineReset = false;
    this.pendingBlockReset = false;
    this.skipLineFeed = false;
    return "";
  }

  private pushChar(char: string, output: string) {
    if (char !== "\n" && char !== "\r" && char !== "\u001b") {
      this.skipLineFeed = false;
    }

    if (this.state.kind === "text") {
      if (char === "\u001b") {
        this.state = { kind: "escape" };
        return output;
      }

      switch (char) {
        case "\n":
          if (this.skipLineFeed) {
            this.skipLineFeed = false;
          } else {
            output = this.pushTranscriptNewline(output);
            this.cursorRow += 1;
            this.cursorCol = 1;
          }
          this.pendingLineReset = false;
          return output;
        case "\t":
          return this.pushVisibleChar(char, output);
        case "\r":
          if (this.pendingLineReset) {
            this.cursorCol = 1;
            this.pendingLineReset = false;
            this.skipLineFeed = true;
            return output;
          }
          if (this.lineHasOutput) {
            output = this.pushTranscriptNewline(output);
            this.cursorRow += 1;
          }
          this.cursorCol = 1;
          this.pendingBlockReset = true;
          this.skipLineFeed = true;
          return output;
        default:
          break;
      }

      if (
        (char >= "\u0000" && char <= "\u0008")
        || char === "\u000b"
        || char === "\u000c"
        || (char >= "\u000e" && char <= "\u001f")
        || char === "\u007f"
      ) {
        return output;
      }

      return this.pushVisibleChar(char, output);
    }

    if (this.state.kind === "escape") {
      if (char === "[") {
        this.state = { kind: "csi", params: "" };
        return output;
      }
      if (char === "]") {
        this.state = { kind: "osc" };
        return output;
      }
      if (char === "\u001b") {
        this.state = { kind: "escape" };
        return output;
      }
      this.state = { kind: "text" };
      return output;
    }

    if (this.state.kind === "csi") {
      if (char === "\u001b") {
        this.state = { kind: "escape" };
        return output;
      }
      if (/[\u0000-\u001f\u007f]/.test(char)) {
        this.state = { kind: "text" };
        return output;
      }
      if (char >= "@" && char <= "~") {
        this.handleCsi(this.state.params, char);
        this.state = { kind: "text" };
        return output;
      }
      this.state = {
        kind: "csi",
        params: this.state.params + char,
      };
      return output;
    }

    if (this.state.kind === "osc") {
      if (char === "\u0007") {
        this.state = { kind: "text" };
        return output;
      }
      if (char === "\u001b") {
        this.state = { kind: "oscEscape" };
        return output;
      }
      return output;
    }

    if (char === "\\" || char === "\u0007") {
      this.state = { kind: "text" };
      return output;
    }
    if (char === "\u001b") {
      this.state = { kind: "oscEscape" };
      return output;
    }
    this.state = { kind: "osc" };
    return output;
  }

  private pushVisibleChar(char: string, output: string) {
    output = this.prepareForVisibleText(output);
    output += char;
    this.cursorCol += 1;
    this.emittedCol = this.cursorCol;
    this.lineHasOutput = true;
    this.pendingLineReset = false;
    this.pendingBlockReset = false;
    return output;
  }

  private prepareForVisibleText(output: string) {
    if (!this.transcriptStarted || this.pendingBlockReset) {
      if (this.transcriptStarted && this.lineHasOutput) {
        output = this.pushTranscriptNewline(output);
      }
      this.transcriptStarted = true;
      this.blockBaseRow = Math.max(this.cursorRow, 1);
      this.emittedRow = 1;
      this.emittedCol = 1;
      this.pendingBlockReset = false;
    }

    const targetRow = this.cursorRow - this.blockBaseRow + 1;
    if (
      targetRow < this.emittedRow
      || (targetRow === this.emittedRow && this.cursorCol < this.emittedCol)
    ) {
      if (this.lineHasOutput) {
        output = this.pushTranscriptNewline(output);
      }
      this.blockBaseRow = Math.max(this.cursorRow, 1);
      this.emittedRow = 1;
      this.emittedCol = 1;
    }

    while (this.emittedRow < targetRow) {
      output = this.pushTranscriptNewline(output);
    }

    const spaces = Math.max(this.cursorCol - this.emittedCol, 0);
    if (spaces > 0) {
      output += " ".repeat(spaces);
      this.emittedCol += spaces;
    }

    return output;
  }

  private pushTranscriptNewline(output: string) {
    this.lineHasOutput = false;
    this.pendingLineReset = false;
    this.emittedRow += 1;
    this.emittedCol = 1;
    return `${output}\n`;
  }

  private handleCsi(params: string, finalChar: string) {
    switch (finalChar) {
      case "m":
        break;
      case "A":
        this.cursorRow = Math.max(1, this.cursorRow - parseCsiCount(params, 1));
        this.pendingBlockReset = true;
        break;
      case "B":
        this.cursorRow += parseCsiCount(params, 1);
        break;
      case "C":
        this.cursorCol += parseCsiCount(params, 1);
        break;
      case "D":
        this.cursorCol = Math.max(1, this.cursorCol - parseCsiCount(params, 1));
        this.pendingBlockReset = true;
        break;
      case "G": {
        const col = parseCsiCount(params, 1);
        if (col < this.cursorCol) {
          this.pendingBlockReset = true;
        }
        this.cursorCol = Math.max(col, 1);
        break;
      }
      case "H":
      case "f": {
        const { row, col } = parseCsiPosition(params);
        if (row < this.cursorRow || (row === this.cursorRow && col < this.cursorCol)) {
          this.pendingBlockReset = true;
        }
        this.cursorRow = Math.max(row, 1);
        this.cursorCol = Math.max(col, 1);
        break;
      }
      case "J":
      case "K":
        this.pendingLineReset = true;
        this.pendingBlockReset = true;
        break;
      default:
        this.pendingBlockReset = true;
        break;
    }
  }
}

export const sanitizeAnsiTranscript = (value: string) => {
  if (!value) return value;
  const sanitizer = new AnsiTranscriptSanitizer();
  const output = sanitizer.push(value);
  sanitizer.finish();
  return output;
};
