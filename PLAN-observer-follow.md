# Observer 跟随 Controller — 实现计划

## 目标

两个浏览器打开同一 workspace 时，Observer（只读方）默认跟随 Controller（写权限方）的当前 session 视角，可手动脱离/重新跟随。

## 最终 UI

```
跟随中：  👁 跟随中 — Session B  [脱离]  [接管控制]
脱离后：  👁 只读模式 — 另一个标签页正在控制  [跟随]  [接管控制]
```

## 架构决策

- 同步粒度：**primary session ID**（当前 Controller 主面板里展示的 session），不同步完整 paneLayout
- 触发时机：Controller 的 paneLayout 变化时（pane 聚焦、session 打开）发出广播
- 存储：ephemeral，不持久化到 DB，服务端只转发
- isFollowing 状态：Jotai atom（需要跨 ObserverBanner 和 providers.tsx 共享）

---

## 实现步骤

### Step 1 — core: 新增 domain event 和 topic

**文件：`packages/core/src/domain/events.ts`**

在 DomainEvent union 末尾追加：
```ts
| { type: 'workspace.view.changed'; workspaceId: string; primarySessionId: string }
```

**文件：`packages/core/src/protocol/topics.ts`**

在 `Topics` 对象里追加（supervisorCycle 之后）：
```ts
// View sync (Observer follow)
workspaceView: (id: string) => `workspace.${id}.view`,
```

---

### Step 2 — server: 新增命令处理

**新文件：`packages/server/src/commands/workspace-view.ts`**

```ts
import type { CommandHandler } from './index';

export const workspaceViewCommands: CommandHandler[] = [
  {
    command: 'workspace.set_view',
    handler: async (ctx, payload) => {
      const { workspaceId, primarySessionId } = payload as {
        workspaceId: string;
        primarySessionId: string;
      };

      ctx.eventBus.emit({
        type: 'workspace.view.changed',
        workspaceId,
        primarySessionId,
      });

      return { ok: true };
    },
  },
];
```

**文件：`packages/server/src/commands/index.ts`**

注册新命令（参考其他命令的注册方式，import workspaceViewCommands 并 spread 进命令列表）。

---

### Step 3 — server: WsHub 广播新事件

**文件：`packages/server/src/ws/hub.ts`**

在 `handleDomainEvent` 方法里，参照 `workspace.meta.changed` 的处理方式追加：

```ts
if (event.type === 'workspace.view.changed') {
  const topic = Topics.workspaceView(event.workspaceId);
  this.broadcast(topic, { primarySessionId: event.primarySessionId });
  return;
}
```

注意：`workspaceView` topic 是控制级（非 stream），不会丢弃。

---

### Step 4 — web: 新增 isFollowing atom

**文件：`packages/web/src/atoms/fencing.ts`**

在文件末尾追加：

```ts
// Whether observer is following controller's view, per workspace
export const isFollowingAtom = atom<Map<string, boolean>>(new Map());

// Helper: check if following for a specific workspace
export const isFollowingForWorkspaceAtom = atom(
  (get) => (workspaceId: string) => {
    const map = get(isFollowingAtom);
    // Default true — observer follows by default
    return map.get(workspaceId) ?? true;
  }
);
```

---

### Step 5 — web: ObserverBanner 加跟随 UI

**文件：`packages/web/src/features/workspace/components/observer-banner.tsx`**

完整替换为：

```tsx
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { fencingStateAtom, isFollowingAtom } from '../../../atoms/fencing';
import { useFencing } from '../../../hooks/use-fencing';
import { sessionsByWorkspaceAtomFamily } from '../../../atoms/sessions';

interface ObserverBannerProps {
  workspaceId: string;
}

export function ObserverBanner({ workspaceId }: ObserverBannerProps) {
  const fencingStates = useAtomValue(fencingStateAtom);
  const state = fencingStates.get(workspaceId);
  const { requestTakeover } = useFencing(workspaceId);

  const followingMap = useAtomValue(isFollowingAtom);
  const setFollowingMap = useSetAtom(isFollowingAtom);
  const isFollowing = followingMap.get(workspaceId) ?? true;

  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));

  const handleTakeover = useCallback(async () => {
    await requestTakeover();
  }, [requestTakeover]);

  const toggleFollow = useCallback(() => {
    setFollowingMap((prev) => {
      const next = new Map(prev);
      next.set(workspaceId, !isFollowing);
      return next;
    });
  }, [workspaceId, isFollowing, setFollowingMap]);

  if (!state || state.isController) {
    return null;
  }

  // Find primary session name for display (populated by workspace.view.changed event)
  // We read it from a data attribute set by providers.tsx via a custom event or atom
  // For simplicity, just show "跟随中" without session name in v1

  return (
    <div className="observer-banner" role="alert">
      <span className="observer-banner-icon">👁</span>
      <span className="observer-banner-text">
        {isFollowing ? '跟随中 — 另一个标签页' : '只读模式 — 另一个标签页正在控制'}
      </span>
      <button
        className="btn btn-secondary btn-sm"
        onClick={toggleFollow}
      >
        {isFollowing ? '脱离' : '跟随'}
      </button>
      <button
        className="btn btn-secondary btn-sm"
        onClick={handleTakeover}
      >
        接管控制
      </button>
    </div>
  );
}
```

---

### Step 6 — web: Controller 发出视角变化命令

**文件：`packages/web/src/features/agent-panes/index.tsx`**

在 paneLayout 变化时，Controller 发出 `workspace.set_view`。

找到现有的 `paneLayout` useEffect 或 pane 操作回调，在 Controller 模式下追加发送：

```ts
// 在现有 import 里加
import { useAtomValue } from 'jotai';
import { isControllerAtom } from '../../atoms/fencing';
import { getWsClient } from '../../ws/client'; // 或现有的 dispatch/wsClient 引用

// 在组件内
const getIsController = useAtomValue(isControllerAtom);
const isController = getIsController(workspaceId);

// 找到 paneLayout 的 useEffect，在变化时发命令
// paneLayout 变化后，找出 primary session（第一个叶节点的 sessionId）
useEffect(() => {
  if (!isController) return;
  const primarySessionId = findPrimarySessionId(paneLayout); // 见下方工具函数
  if (!primarySessionId) return;
  dispatch('workspace.set_view', { workspaceId, primarySessionId }).catch(() => {});
}, [paneLayout, isController, workspaceId]);
```

工具函数（可放在同文件或 `lib/pane-utils.ts`）：

```ts
function findPrimarySessionId(node: PaneNode): string | undefined {
  if (node.type === 'leaf') return node.sessionId;
  if (node.children?.length) return findPrimarySessionId(node.children[0]!);
  return undefined;
}
```

---

### Step 7 — web: providers.tsx 处理 workspace.view.changed 事件

**文件：`packages/web/src/app/providers.tsx`**

在 `routeEventToAtom` 函数里，处理 workspace-level subtopic `view`：

找到 workspace subtopic 的 switch/if 分支（大约在处理 `meta`、`git.state`、`fs.dirty` 的地方），追加：

```ts
// workspace.{id}.view — Observer follow
if (subtopic === 'view') {
  const { primarySessionId } = payload as { primarySessionId: string };

  // Check if this tab is an observer and is following
  const fencingStates = store.get(fencingStateAtom);
  const fencingState = fencingStates.get(workspaceId);
  if (!fencingState || fencingState.isController) return; // Controller ignores

  const followingMap = store.get(isFollowingAtom);
  const isFollowing = followingMap.get(workspaceId) ?? true;
  if (!isFollowing) return; // Detached observer ignores

  // Update pane layout to show primarySessionId in primary pane
  const currentLayout = store.get(paneLayoutAtomFamily(workspaceId));
  const updated = setPrimarySession(currentLayout, primarySessionId);
  store.set(paneLayoutAtomFamily(workspaceId), updated);
  return;
}
```

工具函数 `setPrimarySession`（可放在 `lib/pane-utils.ts`）：

```ts
// Replace the first leaf node's sessionId with the given sessionId
export function setPrimarySession(node: PaneNode, sessionId: string): PaneNode {
  if (node.type === 'leaf') return { ...node, sessionId };
  if (!node.children?.length) return node;
  return {
    ...node,
    children: [
      setPrimarySession(node.children[0]!, sessionId),
      ...node.children.slice(1),
    ],
  };
}
```

需要在 providers.tsx 顶部 import：
```ts
import { isFollowingAtom } from '../atoms/fencing';
import { setPrimarySession } from '../lib/pane-utils'; // 或内联
```

---

## 改动文件汇总

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/core/src/domain/events.ts` | 追加 | 新 event type `workspace.view.changed` |
| `packages/core/src/protocol/topics.ts` | 追加 | 新 topic `workspaceView` |
| `packages/server/src/commands/workspace-view.ts` | 新建 | 处理 `workspace.set_view` 命令 |
| `packages/server/src/commands/index.ts` | 注册 | 引入并注册新命令 |
| `packages/server/src/ws/hub.ts` | 追加 | 广播 `workspace.view.changed` |
| `packages/web/src/atoms/fencing.ts` | 追加 | `isFollowingAtom`、`isFollowingForWorkspaceAtom` |
| `packages/web/src/features/workspace/components/observer-banner.tsx` | 修改 | 加脱离/跟随按钮 |
| `packages/web/src/features/agent-panes/index.tsx` | 追加 | Controller paneLayout 变化时发命令 |
| `packages/web/src/app/providers.tsx` | 追加 | 处理 `workspace.{id}.view` 事件 |
| `packages/web/src/lib/pane-utils.ts` | 新建（可选） | `findPrimarySessionId`、`setPrimarySession` 工具函数 |

## 工作量估计

约 2-4 小时。各步骤相互独立，可按顺序逐步验证：
1. Step 1-3：服务端端到端（命令进来、事件出去）
2. Step 4-5：Observer banner UI 可独立调试
3. Step 6：Controller 发命令（可先用 console.log 验证）
4. Step 7：Observer 响应并更新视图（最终联调）
