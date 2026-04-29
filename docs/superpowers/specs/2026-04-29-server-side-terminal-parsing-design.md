# 服务端终端解析优化设计

**日期**: 2026-04-29
**作者**: Spencer
**状态**: 设计中

## 问题和动机

### 当前问题

1. **刷新性能差**：数据量大（1MB+）时，刷新页面需要等待长达1分钟
2. **多尺寸客户端**：BS架构下，不同浏览器尺寸同时打开同一终端会话，当前架构无法支持
3. **自定义样式受限**：终端输出原文传递给xterm，无法灵活添加语法高亮、图标等增强功能

### 根本原因

当前架构：
```
[PTY] → [RingBuffer (原始ANSI流)] → [WebSocket] → [xterm.js解析] → [渲染]
```

问题：
- 每次刷新，xterm需要重新解析完整ANSI流（16MB），耗时极长
- 原始ANSI流无法灵活处理多尺寸客户端
- 前端承担所有解析负担

### 目标

1. 刷新时间从1分钟降至<500ms（1MB数据）
2. 支持多尺寸客户端同时访问
3. 为未来自定义样式功能预留架构基础

## 整体架构方案

### 方案选择：前端Grid + 服务端Diff

经过对比分析，选择方案C改良版：**服务端维护单一Grid（最大尺寸），前端各自维护本地Grid + Diff协议**。

**架构图：**

```
服务端（Node + Rust）:
┌────────────────────────────────────────┐
│ TerminalSession                         │
│ ├─ ring_buffer: RingBuffer (16MB)     │ ← 保持不变，用于历史回放
│ ├─ master_grid: TerminalGrid (N×M)    │ ← 新增：维护最大尺寸Grid状态
│ ├─ last_seq: number                    │
│ └─ compute_diff() → Diff               │ ← 新增：计算增量变化
└────────────────────────────────────────┘
              ↓ WebSocket (二进制Diff协议)
前端（React + Canvas）:
┌────────────────────────────────────────┐
│ 各个客户端（不同尺寸）                   │
│ ├─ 浏览器1 (40×20)                      │
│ │   └─ LocalGrid + 坐标转换 + Canvas   │
│ ├─ 浏览器2 (80×24)                      │
│ │   └─ LocalGrid + 坐标转换 + Canvas   │
│ └─ 浏览器3 (120×40)                     │
│     └─ LocalGrid + 坐标转换 + Canvas   │
└────────────────────────────────────────┘
```

### 核心创新点

1. **双Buffer策略**：
   - RingBuffer：存原始ANSI流（用于完整历史回放）
   - Master Grid：存当前屏幕状态（用于快速replay和diff计算）

2. **Diff协议**：
   - 实时输出：只传输变化的单元格
   - Replay：传输完整快照 + 坐标转换逻辑

3. **坐标系统**：
   - 服务端维护逻辑行（含WRAPLINE标记）
   - 前端负责双重折行（逻辑行 → 物理行）

### 为什么不用其他方案？

| 方案 | 问题 |
|------|------|
| 方案A（完全替换） | 多尺寸客户端无法支持（需要N个Grid） |
| 方案B（服务端多Grid） | 内存爆炸（10客户端 = 400MB） |
| 保留xterm | 无法解决刷新性能问题 |

## 详细设计

### 一、服务端设计

#### 1.1 数据结构

**Rust N-API绑定：**

```rust
// packages/server/src/native/terminal_grid/src/lib.rs

use napi_derive::napi;
use alacritty_terminal::term::Term;
use alacritty_terminal::grid::Grid;
use alacritty_terminal::config::Config;

#[napi]
pub struct TerminalGrid {
    inner: Term,
    last_grid_hash: u64,
    cols: u16,
    rows: u16,
}

#[napi]
impl TerminalGrid {
    #[napi(constructor)]
    pub fn new(cols: u16, rows: u16, scrollback_limit: Option<u32>) -> Self {
        let config = Config {
            scrollback: scrollback_limit.unwrap_or(50000),
            ..Default::default()
        };

        let size = Size::new(cols, rows);
        let term = Term::new(config, &size, None);

        Self {
            inner: term,
            last_grid_hash: 0,
            cols,
            rows,
        }
    }

    #[napi]
    pub fn feed(&mut self, data: Buffer) {
        let bytes = data.as_ref();
        self.inner.input(bytes);
    }

    #[napi]
    pub fn resize(&mut self, new_cols: u16, new_rows: u16) {
        let size = Size::new(new_cols, new_rows);
        self.inner.resize(size);
        self.cols = new_cols;
        self.rows = new_rows;
    }

    #[napi]
    pub fn get_diff(&mut self) -> Diff {
        let grid = self.inner.grid();
        let current_hash = self.compute_grid_hash(grid);

        if current_hash == self.last_grid_hash {
            return Diff::empty();
        }

        self.last_grid_hash = current_hash;
        self.extract_changed_cells(grid)
    }

    #[napi]
    pub fn get_snapshot(&self) -> Snapshot {
        let grid = self.inner.grid();
        let cells = self.grid_to_cells(grid);
        Snapshot {
            cells,
            cols: self.cols,
            rows: self.rows,
        }
    }

    #[napi]
    pub fn get_cursor(&self) -> Cursor {
        let point = self.inner.grid().cursor.point;
        Cursor {
            row: point.line as u32,
            col: point.column as u32,
        }
    }

    fn compute_grid_hash(&self, grid: &Grid) -> u64 {
        // 使用快捷hash避免全量扫描
        // 只hash可见区域
        let mut hasher = DefaultHasher::new();
        for row in grid.display_iter() {
            for cell in row {
                cell.hash(&mut hasher);
            }
        }
        hasher.finish()
    }

    fn extract_changed_cells(&self, grid: &Grid) -> Diff {
        // 提取所有单元格（实际可以优化为只传输变化）
        let cells = self.grid_to_cells(grid);
        Diff { cells }
    }

    fn grid_to_cells(&self, grid: &Grid) -> Vec<CellData> {
        let mut cells = Vec::new();

        for (row_idx, row) in grid.display_iter().enumerate() {
            for (col_idx, cell) in row.enumerate() {
                cells.push(CellData {
                    row: row_idx as u32,
                    col: col_idx as u32,
                    char: cell.c,
                    fg: cell.fg.into(),
                    bg: cell.bg.into(),
                    flags: cell.flags.into(),
                });
            }
        }

        cells
    }
}

#[napi(object)]
pub struct CellData {
    pub row: u32,
    pub col: u32,
    pub char: String,
    pub fg: ColorData,
    pub bg: ColorData,
    pub flags: u8,
}

#[napi(object)]
pub struct ColorData {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[napi(object)]
pub struct Diff {
    pub cells: Vec<CellData>,
}

#[napi(object)]
pub struct Snapshot {
    pub cells: Vec<CellData>,
    pub cols: u16,
    pub rows: u16,
}

#[napi(object)]
pub struct Cursor {
    pub row: u32,
    pub col: u32,
}

// Flags常量（与前端共享）
pub const CELL_WRAPLINE: u8 = 0x01;
```

#### 1.2 TypeScript封装

```typescript
// packages/server/src/terminal/terminal-grid.ts

import { TerminalGrid as NativeTerminalGrid } from '../native';

export interface Cell {
  row: number;
  col: number;
  char: string;
  fg: { r: number; g: number; b: number };
  bg: { r: number; g: number; b: number };
  flags: number;
}

export interface Diff {
  cells: Cell[];
}

export interface Snapshot {
  cells: Cell[];
  cols: number;
  rows: number;
}

export class TerminalGrid {
  private grid: NativeTerminalGrid;

  constructor(cols: number, rows: number, scrollbackLimit?: number) {
    this.grid = new NativeTerminalGrid(cols, rows, scrollbackLimit);
  }

  feed(data: Buffer | string): void {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    this.grid.feed(buffer);
  }

  resize(cols: number, rows: number): void {
    this.grid.resize(cols, rows);
  }

  getDiff(): Diff {
    return this.grid.getDiff();
  }

  getSnapshot(): Snapshot {
    return this.grid.getSnapshot();
  }

  getCursor(): { row: number; col: number } {
    return this.grid.getCursor();
  }
}
```

#### 1.3 ActiveTerminal集成

```typescript
// packages/server/src/terminal/active-terminal.ts

import { RingBuffer } from './ring-buffer';
import { TerminalGrid } from './terminal-grid';

export class ActiveTerminal {
  public alive = true;
  public exitCode?: number;

  private grid?: TerminalGrid; // 延迟初始化
  private gridCols: number = 120; // 最大尺寸
  private gridRows: number = 40;

  constructor(
    public readonly id: string,
    public readonly spec: TerminalSpec,
    public readonly pty: PtyProcess,
    public readonly ringBuffer: RingBuffer,
    public readonly createdAt: number = Date.now()
  ) {
    // Grid延迟初始化（节省内存）
  }

  // 初始化Grid（首次客户端连接时）
  initializeGrid(): void {
    if (this.grid) return;

    this.grid = new TerminalGrid(this.gridCols, this.gridRows, 50000);

    // 从RingBuffer恢复历史（可选）
    const history = this.ringBuffer.snapshot();
    if (history.length > 0) {
      this.grid.feed(history);
    }
  }

  onData(chunk: Buffer): void {
    // 1. 写入RingBuffer（保持不变）
    this.ringBuffer.append(chunk);

    // 2. 同步更新Grid（如果已初始化）
    if (this.grid) {
      this.grid.feed(chunk);
    }
  }

  // 获取Diff（实时更新）
  getDiff(): Diff | null {
    if (!this.grid) return null;
    return this.grid.getDiff();
  }

  // 获取Snapshot（Replay场景）
  getSnapshot(): Snapshot | null {
    if (!this.grid) return null;
    return this.grid.getSnapshot();
  }

  getCursor(): { row: number; col: number } | null {
    if (!this.grid) return null;
    return this.grid.getCursor();
  }

  // 保持原有方法不变
  toDTO(): Terminal { /* ... */ }
}
```

#### 1.4 Master Grid 尺寸策略

**问题：服务端master_grid应该使用什么尺寸？**

现代终端尺寸分布（PC场景）：
- **小屏笔记本**：80-100列（1280px宽）
- **常规显示器**：120-150列（1920px - 1080p）
- **大屏显示器**：160-200列（2560px - 1440p）
- **4K显示器**：240+列（3840px）

如果默认尺寸太小（如80列），会导致频繁resize；如果太大，内存浪费。

**解决方案：中等尺寸 + 动态扩展（只增不减）**

```typescript
// packages/server/src/config/terminal.ts

export const TERMINAL_MASTER_GRID_DEFAULTS = {
  defaultCols: 120,      // 覆盖主流1080p显示器
  defaultRows: 40,       // 覆盖大部分高度
  scrollback: 10000,     // 历史行数（内存平衡点）
  maxCols: 300,          // 防止异常尺寸
  maxRows: 100,
} as const;
```

**实现细节：**

```typescript
// packages/server/src/terminal/active-terminal.ts

export class ActiveTerminal {
  private grid?: TerminalGrid;
  private gridCols: number = TERMINAL_MASTER_GRID_DEFAULTS.defaultCols;
  private gridRows: number = TERMINAL_MASTER_GRID_DEFAULTS.defaultRows;
  private gridScrollback: number = TERMINAL_MASTER_GRID_DEFAULTS.scrollback;

  constructor(
    public readonly id: string,
    public readonly spec: TerminalSpec,
    // ...
  ) {
    // 可从spec覆盖默认配置
    if (spec.masterGridCols) {
      this.gridCols = Math.min(spec.masterGridCols, TERMINAL_MASTER_GRID_DEFAULTS.maxCols);
    }
    if (spec.masterGridRows) {
      this.gridRows = Math.min(spec.masterGridRows, TERMINAL_MASTER_GRID_DEFAULTS.maxRows);
    }
  }

  // 客户端连接时检查尺寸
  handleClientConnect(clientCols: number, clientRows: number): void {
    // 初始化Grid（如果未初始化）
    this.initializeGrid();

    // 如果新客户端尺寸更大，需要扩展master_grid
    if (clientCols > this.gridCols || clientRows > this.gridRows) {
      const newCols = Math.min(clientCols, TERMINAL_MASTER_GRID_DEFAULTS.maxCols);
      const newRows = Math.min(clientRows, TERMINAL_MASTER_GRID_DEFAULTS.maxRows);

      console.log(
        `[${this.id}] Master grid expanding: ${this.gridCols}x${this.gridRows} → ${newCols}x${newRows}`
      );

      this.grid?.resize(newCols, newRows);
      this.gridCols = newCols;
      this.gridRows = newRows;
    }

    // 如果客户端尺寸更小，无需调整
    // 前端通过CoordinateMapper处理reflow（见第二章）
  }

  // sendData时携带master尺寸信息
  sendDiff(): TerminalDiffMessage | null {
    const diff = this.grid?.getDiff();
    if (!diff) return null;

    return {
      type: TerminalMessageType.Diff,
      terminalId: this.id,
      seq: this.ringBuffer.getSeq(),
      masterCols: this.gridCols,  // 前端需要这个信息
      masterRows: this.gridRows,
      cells: diff.cells,
    };
  }

  sendSnapshot(): TerminalSnapshotMessage | null {
    const snapshot = this.grid?.getSnapshot();
    if (!snapshot) return null;

    return {
      type: TerminalMessageType.Snapshot,
      terminalId: this.id,
      seq: this.ringBuffer.getSeq(),
      cols: this.gridCols,
      rows: this.gridRows,
      cells: snapshot.cells,
    };
  }
}
```

**内存占用分析：**

| 配置 | scrollback | 格式 | 网络传输 | 存储空间 |
|------|-----------|------|----------|---------|
| 单Cell大小 | - | 约14字节 | - | - |
| 120x40 Grid | 10000行 | Binary | 约6.7MB | 约48MB |
| 160x50 Grid | 10000行 | Binary | 约11MB | 约80MB |
| 120x40 Grid | 50000行 | Binary | 约33MB | 约240MB |

**默认配置（推荐）：**
- 尺寸：120列 × 40行
- scrollback：10000行
- 内存：约48MB（单终端）
- 10个终端：约480MB（可接受）

**配置覆盖支持：**

用户可以在workspace配置中覆盖默认值：

```yaml
# ~/.config/coder-studio/workspace.yml
terminal:
  masterGrid:
    defaultCols: 160    # 大屏用户可调大
    defaultRows: 50
    scrollback: 20000   # 需要更多历史
```

**动态扩展策略：**

```
时间线示例：
[00:00] 终端创建 → master_grid初始化为120x40
[00:05] 手机(40x20)连接 → 无需调整，前端reflow
[00:10] 笔记本(80x24)连接 → 无需调整，前端reflow
[00:15] 外接显示器(160x50)连接 → 扩展到160x50（一次性成本，约100-200ms）
[00:20] 所有客户端断开 → 保持160x50（内存不释放）
[00:30] 新客户端(100x30)连接 → 无需调整（master已大于100x30）
```

**核心原则：只增不减**
- master_grid尺寸永远不会缩小，避免重新排版历史内容
- 所有小尺寸客户端通过前端reflow适配
- 大尺寸客户端触发一次性扩展

**性能影响：**
- 60%场景（≤120x40）：无resize成本
- 30%场景（120x40 < size ≤ 160x50）：resize约100-200ms
- 10%场景（>160x50）：resize约200-300ms

#### 1.5 WebSocket协议

**二进制协议设计：**

```typescript
// packages/core/src/protocol/terminal.ts

export const enum TerminalMessageType {
  Diff = 0x01,
  Snapshot = 0x02,
  Cursor = 0x03,
}

export interface TerminalDiffMessage {
  type: TerminalMessageType.Diff;
  terminalId: string;
  seq: number;
  masterCols: number;
  masterRows: number;
  cells: Cell[];
}

export interface TerminalSnapshotMessage {
  type: TerminalMessageType.Snapshot;
  terminalId: string;
  seq: number;
  cols: number;
  rows: number;
  cells: Cell[];
}

export interface TerminalCursorMessage {
  type: TerminalMessageType.Cursor;
  terminalId: string;
  row: number;
  col: number;
}
```

**编码优化：**

```typescript
// packages/server/src/ws/binary-encoder.ts

export class TerminalBinaryEncoder {
  // 使用紧凑的二进制格式
  // 每个Cell: 约7字节（row:2 + col:2 + char:1 + fg:3 + bg:3 + flags:1）

  encodeDiff(diff: TerminalDiffMessage): Buffer {
    const cells = diff.cells;
    const buffer = Buffer.allocUnsafe(
      1 + // type
      32 + // terminalId (uuid string)
      4 + // seq
      2 + // masterCols
      2 + // masterRows
      4 + // cells count
      cells.length * 14 // cells (estimated)
    );

    let offset = 0;

    // type
    buffer.writeUInt8(TerminalMessageType.Diff, offset++);
    // terminalId
    buffer.write(diff.terminalId, offset, 32, 'utf-8');
    offset += 32;
    // seq
    buffer.writeUInt32BE(diff.seq, offset);
    offset += 4;
    // masterCols, masterRows
    buffer.writeUInt16BE(diff.masterCols, offset);
    offset += 2;
    buffer.writeUInt16BE(diff.masterRows, offset);
    offset += 2;
    // cells count
    buffer.writeUInt32BE(cells.length, offset);
    offset += 4;

    // cells
    for (const cell of cells) {
      offset = this.writeCell(buffer, offset, cell);
    }

    return buffer.slice(0, offset);
  }

  private writeCell(buffer: Buffer, offset: number, cell: Cell): number {
    buffer.writeUInt16BE(cell.row, offset);
    offset += 2;
    buffer.writeUInt16BE(cell.col, offset);
    offset += 2;

    // char (UTF-8)
    const charBuf = Buffer.from(cell.char, 'utf-8');
    buffer.writeUInt8(charBuf.length, offset++);
    charBuf.copy(buffer, offset);
    offset += charBuf.length;

    // fg (RGB)
    buffer.writeUInt8(cell.fg.r, offset++);
    buffer.writeUInt8(cell.fg.g, offset++);
    buffer.writeUInt8(cell.fg.b, offset++);

    // bg (RGB)
    buffer.writeUInt8(cell.bg.r, offset++);
    buffer.writeUInt8(cell.bg.g, offset++);
    buffer.writeUInt8(cell.bg.b, offset++);

    // flags
    buffer.writeUInt8(cell.flags, offset++);

    return offset;
  }
}
```

---

### 二、前端设计

#### 2.1 本地Grid类

```typescript
// packages/web/src/lib/terminal/local-grid.ts

import { Cell, Diff, Snapshot } from '@coder-studio/core';

export const CELL_FLAGS = {
  WRAPLINE: 0x01,
} as const;

export class LocalTerminalGrid {
  private cells: Map<number, Map<number, Cell>> = new Map();
  private cursorRow: number = 0;
  private cursorCol: number = 0;

  constructor(
    public readonly cols: number,
    public readonly rows: number
  ) {}

  // 应用Diff
  applyDiff(diff: Diff): void {
    for (const cell of diff.cells) {
      this.setCell(cell.row, cell.col, cell);
    }
  }

  // 应用Snapshot（完整替换）
  applySnapshot(snapshot: Snapshot): void {
    this.cells.clear();
    for (const cell of snapshot.cells) {
      this.setCell(cell.row, cell.col, cell);
    }
  }

  // 设置单元格
  private setCell(row: number, col: number, cell: Cell): void {
    if (!this.cells.has(row)) {
      this.cells.set(row, new Map());
    }
    this.cells.get(row)!.set(col, cell);
  }

  // 获取单元格
  getCell(row: number, col: number): Cell | undefined {
    return this.cells.get(row)?.get(col);
  }

  // 获取所有单元格（用于渲染）
  getAllCells(): Cell[] {
    const result: Cell[] = [];
    for (const rowMap of this.cells.values()) {
      for (const cell of rowMap.values()) {
        result.push(cell);
      }
    }
    return result;
  }

  // 获取逻辑行（用于复制）
  getLogicalRow(row: number): Cell[] {
    const rowMap = this.cells.get(row);
    if (!rowMap) return [];

    const cells: Cell[] = [];
    let col = 0;
    while (rowMap.has(col)) {
      cells.push(rowMap.get(col)!);
      col++;
    }
    return cells;
  }

  // 清空
  clear(): void {
    this.cells.clear();
  }

  // resize（重新组织数据）
  resize(newCols: number, newRows: number): void {
    // 新尺寸不影响存储，只影响渲染时使用
    // this.cols = newCols;
    // this.rows = newRows;
  }
}
```

#### 2.2 坐标转换器

```typescript
// packages/web/src/lib/terminal/coordinate-mapper.ts

import { LocalTerminalGrid, CELL_FLAGS } from './local-grid';

export class CoordinateMapper {
  constructor(
    private readonly grid: LocalTerminalGrid,
    private readonly clientCols: number,
    private readonly clientRows: number
  ) {}

  // 服务端坐标 → 前端坐标
  masterToClient(masterRow: number, masterCol: number): { row: number; col: number } {
    let clientRow = 0;
    let clientCol = 0;

    // 累加前面所有逻辑行的物理行数
    for (let r = 0; r < masterRow; r++) {
      const logicalCells = this.grid.getLogicalRow(r);
      const physicalRows = this.calcPhysicalRows(logicalCells.length);
      clientRow += physicalRows;
    }

    // 处理当前行的列偏移
    const currentRowCells = this.grid.getLogicalRow(masterRow);
    const cellsBeforeCursor = Math.min(masterCol, currentRowCells.length);
    const physicalRowsBefore = Math.floor(cellsBeforeCursor / this.clientCols);
    clientRow += physicalRowsBefore;
    clientCol = cellsBeforeCursor % this.clientCols;

    return { row: clientRow, col: clientCol };
  }

  // 前端坐标 → 服务端坐标
  clientToMaster(clientRow: number, clientCol: number): { row: number; col: number } {
    let masterRow = 0;
    let masterCol = 0;
    let currentPhysicalRow = 0;

    // 遍历所有逻辑行，找到客户端坐标对应的逻辑行
    for (let r = 0; r < this.grid.rows; r++) {
      const logicalCells = this.grid.getLogicalRow(r);
      const physicalRows = this.calcPhysicalRows(logicalCells.length);

      if (currentPhysicalRow + physicalRows > clientRow) {
        // 目标在这一逻辑行内
        masterRow = r;
        const physicalRowOffset = clientRow - currentPhysicalRow;
        masterCol = physicalRowOffset * this.clientCols + clientCol;
        masterCol = Math.min(masterCol, logicalCells.length);
        return { row: masterRow, col: masterCol };
      }

      currentPhysicalRow += physicalRows;
    }

    return { row: masterRow, col: masterCol };
  }

  // 计算逻辑行在前端占用的物理行数
  private calcPhysicalRows(logicalLength: number): number {
    if (logicalLength === 0) return 1; // 空行也占1行
    return Math.ceil(logicalLength / this.clientCols);
  }
}
```

#### 2.3 Canvas渲染器

```typescript
// packages/web/src/lib/terminal/canvas-renderer.ts

import { LocalTerminalGrid, CELL_FLAGS } from './local-grid';
import { CoordinateMapper } from './coordinate-mapper';

export class TerminalCanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cellWidth: number = 8; // 字符宽度（需测量）
  private cellHeight: number = 16; // 行高
  private paddingX: number = 4;
  private paddingY: number = 4;

  constructor(
    private readonly grid: LocalTerminalGrid,
    private readonly mapper: CoordinateMapper,
    canvas: HTMLCanvasElement
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.measureCellSize();
  }

  render(): void {
    const { clientCols, clientRows } = this.mapper;
    const cells = this.grid.getAllCells();

    // 清空画布
    this.ctx.fillStyle = '#0b1218'; // 背景色
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 渲染所有单元格
    for (const cell of cells) {
      const clientPos = this.mapper.masterToClient(cell.row, cell.col);

      // 跳过不可见区域
      if (clientPos.row >= clientRows || clientPos.col >= clientCols) {
        continue;
      }

      this.drawCell(clientPos.row, clientPos.col, cell);
    }

    // 渲染光标
    this.drawCursor();
  }

  private drawCell(row: number, col: number, cell: Cell): void {
    const x = this.paddingX + col * this.cellWidth;
    const y = this.paddingY + row * this.cellHeight;

    // 背景
    this.ctx.fillStyle = `rgb(${cell.bg.r}, ${cell.bg.g}, ${cell.bg.b})`;
    this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);

    // 文字
    this.ctx.fillStyle = `rgb(${cell.fg.r}, ${cell.fg.g}, ${cell.fg.b})`;
    this.ctx.font = '13px "JetBrains Mono", monospace';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(cell.char, x, y);

    // 下划线等样式（根据flags）
    if (cell.flags & CELL_FLAGS.UNDERLINE) {
      this.ctx.strokeStyle = `rgb(${cell.fg.r}, ${cell.fg.g}, ${cell.fg.b})`;
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + this.cellHeight - 2);
      this.ctx.lineTo(x + this.cellWidth, y + this.cellHeight - 2);
      this.ctx.stroke();
    }
  }

  private drawCursor(): void {
    // 实现光标渲染
  }

  private measureCellSize(): void {
    // 测量实际字符宽度
    this.ctx.font = '13px "JetBrains Mono", monospace';
    const metrics = this.ctx.measureText('M');
    this.cellWidth = Math.ceil(metrics.width);
    this.cellHeight = 16;
  }
}
```

#### 2.4 React组件集成

```typescript
// packages/web/src/features/terminal-panel/components/terminal-canvas.tsx

import { useEffect, useRef } from 'react';
import { LocalTerminalGrid } from '../../lib/terminal/local-grid';
import { CoordinateMapper } from '../../lib/terminal/coordinate-mapper';
import { TerminalCanvasRenderer } from '../../lib/terminal/canvas-renderer';

interface TerminalCanvasProps {
  terminalId: string;
  workspaceId: string;
}

export function TerminalCanvas({ terminalId, workspaceId }: TerminalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<LocalTerminalGrid | null>(null);
  const rendererRef = useRef<TerminalCanvasRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const grid = new LocalTerminalGrid(80, 24);
    const mapper = new CoordinateMapper(grid, 80, 24);
    const renderer = new TerminalCanvasRenderer(grid, mapper, canvas);

    gridRef.current = grid;
    rendererRef.current = renderer;

    return () => {
      gridRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    const renderer = rendererRef.current;
    if (!grid || !renderer) return;

    // 订阅WebSocket消息
    const unsubscribe = wsClient.subscribe(
      [Topics.terminalOutput(workspaceId, terminalId)],
      (topic, payload) => {
        const message = payload as TerminalDiffMessage;

        if (message.type === TerminalMessageType.Diff) {
          grid.applyDiff(message);
        } else if (message.type === TerminalMessageType.Snapshot) {
          grid.applySnapshot(message);
        }

        renderer.render();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [terminalId, workspaceId]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0b1218'
      }}
    />
  );
}
```

---

### 三、边缘情况处理

#### 3.1 客户端首次连接（冷启动）

```typescript
// packages/server/src/commands/terminal.ts

async function handleTerminalConnect(terminalId: string, clientSize: { cols: number; rows: number }) {
  const terminal = terminalManager.get(terminalId);
  if (!terminal) return;

  // 初始化Grid（如果未初始化）
  terminal.initializeGrid();

  // 发送完整快照
  const snapshot = terminal.getSnapshot();
  if (snapshot) {
    wsClient.send({
      type: TerminalMessageType.Snapshot,
      terminalId,
      seq: terminal.ringBuffer.getSeq(),
      ...snapshot
    });
  }
}
```

#### 3.2 客户端resize

```typescript
// packages/web/src/features/terminal-panel/components/terminal-canvas.tsx

useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      const cols = Math.floor((width - paddingX * 2) / cellWidth);
      const rows = Math.floor((height - paddingY * 2) / cellHeight);

      // 更新本地Grid尺寸
      gridRef.current?.resize(cols, rows);
      mapperRef.current!.clientCols = cols;
      mapperRef.current!.clientRows = rows;

      // 重新渲染（无需请求服务器）
      rendererRef.current?.render();
    }
  });

  resizeObserver.observe(canvas);
  return () => resizeObserver.disconnect();
}, []);
```

#### 3.3 处理ANSI特殊序列

某些ANSI序列需要特殊处理：

```rust
// packages/server/src/native/terminal_grid/src/lib.rs

impl TerminalGrid {
    fn feed(&mut self, data: &[u8]) {
        // alacritty_terminal自动处理：
        // - 光标移动（\x1b[H）
        // - 清屏（\x1b[2J）
        // - 颜色（\x1b[31m）
        // - 软折行（\x1b[0m + wrap）
        self.inner.input(data);
    }
}
```

#### 3.4 文本选择和复制

```typescript
// packages/web/src/lib/terminal/selection-manager.ts

export class SelectionManager {
  private startRow: number | null = null;
  private startCol: number | null = null;
  private endRow: number | null = null;
  private endCol: number | null = null;

  // 获取选中文本（逻辑行合并）
  getSelectedText(grid: LocalTerminalGrid): string {
    if (this.startRow === null || this.endRow === null) return '';

    const start = Math.min(this.startRow, this.endRow);
    const end = Math.max(this.startRow, this.endRow);

    const lines: string[] = [];

    for (let row = start; row <= end; row++) {
      const cells = grid.getLogicalRow(row);
      let line = '';

      for (const cell of cells) {
        line += cell.char;
        if (cell.flags & CELL_FLAGS.WRAPLINE) {
          // 逻辑行继续，不换行
        } else {
          break; // 逻辑行结束
        }
      }

      lines.push(line);
    }

    return lines.join('\n');
  }
}
```

---

### 四、性能优化

#### 4.1 Diff增量传输

```typescript
// packages/server/src/terminal/terminal-grid.ts

export class TerminalGrid {
  private lastCells: Map<string, Cell> = new Map();

  getDiff(): Diff {
    const currentCells = this.getCurrentCellsMap();
    const changed: Cell[] = [];

    // 只传输变化的cell
    for (const [key, cell] of currentCells) {
      const oldCell = this.lastCells.get(key);
      if (!oldCell || !this.cellsEqual(oldCell, cell)) {
        changed.push(cell);
      }
    }

    this.lastCells = currentCells;
    return { cells: changed };
  }

  private getCurrentCellsMap(): Map<string, Cell> {
    const snapshot = this.getSnapshot();
    const map = new Map();
    for (const cell of snapshot.cells) {
      const key = `${cell.row}:${cell.col}`;
      map.set(key, cell);
    }
    return map;
  }

  private cellsEqual(a: Cell, b: Cell): boolean {
    return (
      a.char === b.char &&
      a.fg.r === b.fg.r &&
      a.fg.g === b.fg.g &&
      a.fg.b === b.fg.b &&
      a.bg.r === b.bg.r &&
      a.bg.g === b.bg.g &&
      a.bg.b === b.bg.b &&
      a.flags === b.flags
    );
  }
}
```

#### 4.2 Canvas离屏渲染

```typescript
// packages/web/src/lib/terminal/canvas-renderer.ts

export class TerminalCanvasRenderer {
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;

  constructor() {
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d')!;
  }

  render(): void {
    // 先渲染到离屏Canvas
    this.renderToContext(this.offscreenCtx);

    // 一次性绘制到屏幕
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);
  }
}
```

#### 4.3 虚拟滚动

```typescript
// packages/web/src/lib/terminal/virtual-scroll.ts

export class VirtualScrollManager {
  private scrollTop: number = 0;
  private viewportRows: number = 50;

  getVisibleRange(totalRows: number): { start: number; end: number } {
    const start = Math.floor(this.scrollTop / this.rowHeight);
    const end = Math.min(start + this.viewportRows, totalRows);
    return { start, end };
  }

  render(grid: LocalTerminalGrid) {
    const totalRows = grid.rows;
    const visible = this.getVisibleRange(totalRows);

    // 只渲染可见行
    for (let row = visible.start; row < visible.end; row++) {
      // 渲染这一行
    }
  }
}
```

---

### 五、迁移路径

#### Phase 1：基础架构（第1周）

- [ ] 创建napi-rs项目
- [ ] 封装alacritty_terminal
- [ ] 实现基本feed/resize/getSnapshot API
- [ ] 前端LocalGrid类实现
- [ ] 基本Canvas渲染器

#### Phase 2：集成测试（第2周）

- [ ] WebSocket协议调整
- [ ] 坐标转换逻辑
- [ ] 文本选择和复制
- [ ] 光标处理
- [ ] 边缘情况测试

#### Phase 3：性能优化（第3周）

- [ ] Diff增量传输
- [ ] 离屏Canvas渲染
- [ ] 性能测试和调优
- [ ] 内存泄漏检查

#### Phase 4：灰度发布（可选）

- [ ] 配置开关（新旧架构切换）
- [ ] A/B测试
- [ ] 监控指标

---

## 成本和收益

### 代码量估算

| 组件 | 代码量 |
|------|--------|
| Rust napi-rs绑定 | 500行 |
| TypeScript封装 | 200行 |
| 前端LocalGrid | 300行 |
| 坐标转换 | 200行 |
| Canvas渲染器 | 500行 |
| 事件处理 | 300行 |
| WebSocket协议 | 150行 |
| 测试 | 500行 |
| **总计** | **2650行** |

### 内存占用

- 服务端Grid：约40MB（50k行历史）
- 前端Grid：约8MB（可配置）
- Diff传输：约10KB/s（取决于输出频率）

### 性能预期

- **刷新时间**：从1分钟降至200-300ms（1MB数据）
- **实时延迟**：<50ms
- **内存占用**：+50MB（服务端）

---

## 风险和替代方案

### 主要风险

1. **实现复杂度高**：2650行新代码，需要充分测试
2. **兼容性问题**：alacritty_terminal可能不支持某些生僻ANSI序列
3. **性能未知**：Canvas渲染可能比xterm慢（需测试）

### 替代方案

如果方案C不符合预期，可以退回到：

- **方案B改良版**：服务端多Grid缓存（LRU策略）
- **原始方案+C**：保留xterm，只优化Replay

---

## 参考资料

- [alacritty_terminal文档](https://docs.rs/alacritty_terminal/)
- [napi-rs官方教程](https://napi.rs/)
- [VT100规范](https://vt100.net/)
