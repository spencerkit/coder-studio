# Modal

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Modal open onOpenChange={setOpen}>
  <ModalHeader>
    <ModalTitle>Workspace details</ModalTitle>
  </ModalHeader>
  <ModalBody>Body</ModalBody>
  <ModalFooter>Footer</ModalFooter>
</Modal>
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `open` | `boolean` | 必填 | 控制弹窗显示 |
| `onOpenChange` | `(open: boolean) => void` | 必填 | 请求关闭时回调 |
| `size` | `"sm" \| "md" \| "lg" \| "full"` | `"md"` | 卡片宽度 |
| `dismissible` | `boolean` | `true` | 是否允许遮罩点击和 `Escape` 关闭 |
| `initialFocus` | `HTMLElement \| null \| (() => HTMLElement \| null)` | `undefined` | 打开后优先聚焦的元素 |
| `className` | `string` | `undefined` | 透传到 dialog shell |

## 注意
- 组件通过 portal 渲染到 `document.body`。
- 打开后会把焦点移入弹窗，关闭后恢复到先前焦点。
- 迁移期仍保留 `modal-overlay`、`modal-card`、`modal-header`、`modal-title`、`modal-body`、`modal-footer` 等兼容类名。
