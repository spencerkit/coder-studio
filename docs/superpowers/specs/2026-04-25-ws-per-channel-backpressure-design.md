# WS 反压：从 per-socket 到 per-channel + per-topic 子队列

- 日期：2026-04-25
- 范围：`packages/server/src/ws/*`
- 影响：服务端 WebSocket 发送路径；客户端协议无改动

## 问题

`packages/server/src/ws/client.ts:77-81` 把反压判定放在 socket 级别：

```ts
if (this.socket.bufferedAmount > 1024 * 1024) {
  console.warn(`Client ${this.id} has high backpressure, dropping message`);
  return false;
}
```

后果：

1. 任一客户端 send buffer 超过 1 MiB 时，**接下来的全部事件**都会被丢，不区分 topic。高频 PTY 流会连坐控制类事件（`session.state.changed`、`workspace.meta.changed`、命令结果等）。
2. 控制类事件丢了之后没有客户端可见的恢复路径——payload 是"覆盖语义"，丢一帧就意味着前端状态停留在旧值，直到下一次同 topic 推送。
3. 多个终端并发时，A 终端撑爆 wire 会导致 B 终端的输出一并被丢，制造噪声邻居。

## 目标

- 控制类事件**永不**因反压被丢
- 流类事件（仅 `terminal.*.output`）拥塞时仅丢自身**最旧**的帧，最新一帧最终能上线
- 不同流类 topic 之间**互不连坐**
- 客户端协议零改动；前端 seq-gap+`terminal.replay` 路径继续生效，无需触碰

## 非目标（明确不做）

- 不引入新的协议消息（不加 `terminal.*.drop` 事件、不加流控握手）
- 不动 base64/JSON 编码（=问题 2，单独 PR）
- 不修补 `Event` 信封里永远为 0 的 `seq` 字段（独立卫生议题）
- 不改前端任何代码

## 方案 D：二分类 + 流类按 topic 分子队列

### 整体形状

`WsClient` 内部分两条发送路径：

- **control**：直接 `socket.send()`，不看 `bufferedAmount`，永不丢
- **stream**：经 `StreamBuffer`（按 topic 分桶 + 公平轮询 + drop oldest），按需启停的定时器在 `socket.bufferedAmount` 落到 LOW 水位时刷出

`WsHub.handleDomainEvent` 是分类的唯一权威：`terminal.output` 走 stream，其他 7 种 DomainEvent 走 control。其他 hub 入口（`broadcast`、`sendToClient`、`takeover`、`handleResync`、命令结果回送）一律走 control（当前没有 stream 流量经这些路径）。

### 容量与水位

- `HIGH_WATER = 512 KiB`：socket bufferedAmount ≥ HIGH 时不再往 socket 推 stream，新帧入桶
- `LOW_WATER  = 128 KiB`：bufferedAmount < LOW 时恢复刷桶
- `STREAM_TOPIC_CAP = 256 KiB`：每个 topic 子队列上限
- `STREAM_TOPIC_LRU = 16`：活跃 topic 上限；超过时淘汰最久未写的整桶
- `FLUSH_INTERVAL_MS = 30`

3 终端并发最坏内存放大：3 × 256 KiB（应用层）+ 512 KiB（socket）≈ 1.3 MiB / 客户端。

控制类事件不消耗 stream 桶。

### 组件

#### `packages/server/src/ws/topic-class.ts`（新）

```ts
export function isStreamTopic(topic: string): boolean {
  return /^workspace\.[^.]+\.terminal\.[^.]+\.output$/.test(topic);
}
```

集中维护，将来扩流类只改这一处。

#### `packages/server/src/ws/stream-buffer.ts`（新）

```ts
interface Frame {
  data: string;   // 已 JSON.stringify 的 ServerToClient
  size: number;   // data 字节长度
}

class StreamBuffer {
  enqueue(topic: string, frame: Frame): void;
  drain(maxBytes: number, send: (data: string) => boolean): void;
  isEmpty(): boolean;
  destroy(): void;
}
```

行为：

- `enqueue`：累计字节超 `STREAM_TOPIC_CAP` 时弹最旧的帧；超 `STREAM_TOPIC_LRU` 个 topic 时按"最久未写"整桶淘汰
- `enqueue` 即使单帧 size 超过 cap 也接受（作为唯一一帧入队，被后续帧自然挤掉）
- `drain`：公平轮询每个 topic 各出一帧，直到累计 send 字节 ≥ `maxBytes` 或 `send` 返回 false 或全部桶空。维护游标避免高频 topic 抢光窗口
- `destroy`：清空所有桶，幂等

#### `packages/server/src/ws/client.ts`（改）

新增字段：

```ts
private readonly streamBuffer = new StreamBuffer();
private flushTimer: NodeJS.Timeout | null = null;
```

新增方法：

```ts
sendControl(msg: ServerToClient): boolean       // 等价旧 send，不看 bufferedAmount
sendStream(topic: string, msg: ServerToClient): void
sendEventStream(topic: string, data: unknown): void   // 镜像 sendEvent
private flushStream(): void
private ensureFlushTimer(): void
private clearFlushTimer(): void
```

`send(msg)` 保留为 `return this.sendControl(msg)`，hub/dispatch 现有调用点不破。

#### `packages/server/src/ws/hub.ts`（改）

`handleDomainEvent` 的 `terminal.output` 分支改用 `client.sendEventStream(topic, data)`；其他保持 `client.sendEvent`。`broadcast()` 内部按 `isStreamTopic(topic)` 二分发送方式。其余路径不动。

### 数据流

#### 流类（terminal.output）

```
PTY onData
  → terminal/manager 写 RingBuffer，分配 seq
  → eventBus.emit('terminal.output', {chunk, seq, ...})
  → WsHub.handleDomainEvent
  → for each subscriber client：client.sendEventStream(topic, payload)
  → WsClient.sendStream(topic, msg)
      → JSON.stringify → Frame{data, size}
      → StreamBuffer.enqueue(topic, frame)（满则 drop oldest）
      → flushStream()
          if bufferedAmount < HIGH:
              StreamBuffer.drain(HIGH - bufferedAmount, socket.send)
          else:
              ensureFlushTimer()
```

#### 拥塞→恢复闭环

```
flushTimer tick (30 ms):
  if bufferedAmount < LOW:
      drain 直到 (a) 桶空 (b) 又触 HIGH (c) send 失败
  if StreamBuffer.isEmpty(): clearFlushTimer()
  else: 留着继续 tick
```

#### 控制类

```
client.send(msg) ≡ sendControl(msg)
  if socket.OPEN: socket.send(JSON.stringify(msg)); return true
  else: return false
不入桶、不查 bufferedAmount、不启动定时器
```

#### 客户端侧（不变）

```
收 Event { topic, data }
  → routeEventToAtom
  → terminal.*.output：xterm-host 比对 data.seq 与 lastSeq
       连续 → 写 xterm；gap → terminal.replay(lastSeq) 拉补丁
  → 其他：直接覆盖对应 atom
```

#### 关闭路径

```
socket close → flushTimer 清掉 → streamBuffer.destroy() → handleClose 走原逻辑
```

### 错误处理与边界

| 场景 | 行为 |
|---|---|
| `socket.send` 抛错（control） | 已有 try/catch，返回 false；上层日志 |
| `socket.send` 抛错（drain 中） | 包 try/catch，停止本轮 flush，**不**清桶；可能临时故障 |
| `readyState !== OPEN` 时 flush | clearFlushTimer + streamBuffer.destroy 退出 |
| 单帧 size > cap | 接受为唯一一帧入队；下一帧到达时被挤掉 |
| topic LRU 淘汰 | 整桶丢弃；下次该 topic 帧到达时前端 seq-gap 检测触发 replay |
| 终端正常 exit | `terminal.exited` 控制类事件让前端清 UI；server stream 桶靠 LRU 兜底 |
| 客户端未订阅 topic | `broadcast()` 入口已用 `subscribesTo` 过滤；未订阅不入桶 |
| 测试 fake socket 的 bufferedAmount | 兜底 `this.socket.bufferedAmount ?? 0` |

### 测试策略

延续仓库约定：Vitest + `__tests__/*.test.ts` + ws mock socket（参考现有 `ws-client.test.ts`）。

#### 新增 `stream-buffer.test.ts`

- enqueue 越界丢最旧（FIFO 验证）
- 第 17 个 topic 触发 LRU 淘汰最久未写
- A、B 两 topic 各 2 帧 → drain 顺序 A1→B1→A2→B2（公平轮询）
- drain 中 send 返回 false → 停止，未发的帧仍在桶
- destroy 后 enqueue 不抛、drain 无副作用

#### 新增 `ws-client-stream.test.ts`（或扩 `ws-client.test.ts`）

- 低 buffer 时 sendStream 直发，无 flushTimer
- buffer ≥ HIGH 时 sendStream 入队 + 启 flushTimer
- buffer 跌至 LOW 后 tick → 队列被刷出
- 桶空 → flushTimer 清掉
- close → buffer destroy + timer 清
- **核心**：buffer 高时 sendControl 仍直送，不受反压影响

#### 新增 `topic-class.test.ts`

- `workspace.X.terminal.Y.output` → true
- `workspace.X.terminal.Y.created`、`workspace.X.session.Z.state`、`connection.status` → false

#### 扩 `ws-hub.test.ts`

- `terminal.output` DomainEvent 调用 `sendEventStream`
- 其他 7 种 DomainEvent 调用 `sendEvent`（control）
- 订阅过滤仍生效：未订阅终端的客户端不入桶

#### 现有测试

- `ws-client.test.ts`、`ws-hub.test.ts`：`send` 重定向到 `sendControl` 同语义，应保持绿
- `xterm-host.test.tsx`：前端零改动，不受影响

#### 覆盖率

满足项目 80% 行覆盖；`stream-buffer.ts` 期望 ≥ 90%。

## 验收

- [ ] 控制类事件在持续高负载终端流下仍按时到达（手测：开 `cat /dev/urandom | base64`，同时 rename workspace 应立刻反映）
- [ ] 终端 A 撑爆时，终端 B 输出不卡顿（手测：两个 PTY，A 高频，B 低频）
- [ ] 客户端关闭后服务端无残留 timer/桶（手测：watch 进程内存稳定）
- [ ] 全部新单测 + 既有单测通过
