# DateTimePicker 组件设计

> **版本：** 1.0  
> **日期：** 2026-05-11  
> **状态：** Draft  
> **作者：** 技术共同设计

## 0. 概述

为组件库新增一个共享的 `DateTimePicker` 组件，用于选择日期和时间。组件需支持桌面端和移动端，复用现有的 `Popover` 和 `Sheet` 容器，对外读写本地 `YYYY-MM-DDTHH:mm` 格式的字符串值。

### 0.1 目标

- 提供一个统一的日期时间选择器，可在多个表单场景复用
- 桌面端使用 `Popover` 展示选择面板，移动端使用 `Sheet`
- 支持清空、快速选择（今天、明天等）、手动输入时间
- 对外 API 与现有 `Input`/`Select` 保持一致的风格

### 0.2 非目标

- 不做完整的日期库级组件（日期范围选择、日历视图切换等）
- 不引入第三方日期库（dayjs、date-fns 等）
- 不支持时区选择（统一使用本地时区）

## 1. 组件 API

### 1.1 Props

```tsx
interface DateTimePickerProps {
  // 值：本地时间字符串，格式 YYYY-MM-DDTHH:mm
  readonly value: string;
  
  // 值变化回调
  readonly onValueChange: (value: string) => void;
  
  // 标签（用于 aria-label 和移动端 sheet title）
  readonly label: string;
  
  // 占位符文本
  readonly placeholder?: string;
  
  // 是否禁用
  readonly disabled?: boolean;
  
  // 是否显示清空按钮
  readonly clearable?: boolean;
  
  // 最小日期
  readonly minDate?: Date;
  
  // 最大日期
  readonly maxDate?: Date;
  
  // 自定义类名
  readonly className?: string;
  
  // 尺寸
  readonly size?: "sm" | "md" | "lg";
  
  // 是否无效
  readonly invalid?: boolean;
  
  // aria-describedby
  readonly "aria-describedby"?: string;
}
```

### 1.2 值格式

- 输入/输出值均为本地时间字符串：`YYYY-MM-DDTHH:mm`
- 例如：`2026-05-11T14:30`
- 空值用空字符串 `""` 表示
- 组件内部处理 `Date` 对象与字符串之间的转换

### 1.3 使用示例

```tsx
function ExampleForm() {
  const [scheduledAt, setScheduledAt] = useState("");
  
  return (
    <DateTimePicker
      label="Scheduled At"
      value={scheduledAt}
      onValueChange={setScheduledAt}
      placeholder="Select date and time"
      clearable
    />
  );
}
```

## 2. 交互设计

### 2.1 桌面端

1. 点击触发器打开 `Popover`
2. Popover 内容包含：
   - 月份导航（上一月/下一月按钮）
   - 日历网格（周日至周六）
   - 时间选择器（小时和分钟下拉）
   - 快速选择按钮（今天、明天、下周）
   - 清空按钮（可选）
3. 选择日期后自动关闭，或点击外部关闭
4. 键盘支持：
   - `Escape` 关闭
   - `Tab` 在面板内导航
   - `Enter` 确认选择

### 2.2 移动端

1. 点击触发器打开全屏 `Sheet`
2. Sheet 内容包含：
   - 月份导航
   - 日历网格
   - 时间选择器（滚轮或下拉）
   - 快速选择按钮
   - 底部操作栏：清空 / 确认
3. 选择后需点击"确认"按钮关闭
4. 支持返回手势关闭

### 2.3 触发器样式

- 触发器外观与 `Select` 组件的 listbox 模式一致
- 显示当前选中的日期时间，或占位符文本
- 右侧显示日历图标
- 支持 `invalid` 状态的红色边框

## 3. 实现细节

### 3.1 文件结构

```
packages/web/src/components/ui/datetime-picker/
├── index.tsx              # 主组件
├── index.test.tsx         # 单元测试
├── index.module.css       # 样式
├── calendar-grid.tsx      # 日历网格子组件
├── time-selector.tsx      # 时间选择子组件
└── README.md              # 文档
```

### 3.2 依赖关系

- 复用 `Popover` 组件（桌面端）
- 复用 `Sheet` 组件（移动端）
- 复用 `useViewport` 判断桌面/移动端
- 复用 `Input` 样式（触发器）
- 使用现有 `formatDate` 函数显示日期

### 3.3 日期计算

使用原生 `Date` API：
- 不引入第三方日期库
- 使用 `Date.getMonth()`、`Date.getDate()` 等
- 使用 `new Date(year, month, day, hour, minute)` 构造

### 3.4 样式

- 日历网格使用 CSS Grid
- 使用设计系统的间距变量
- 使用设计系统的颜色变量
- 日历单元格高度 `44px`（移动端友好）

## 4. 接入 Supervisor

### 4.1 替换现有 Input

在 `objective-dialog-content.tsx` 中：

```tsx
// 之前
<Input
  id="scheduled-at"
  size="lg"
  type="datetime-local"
  value={draftScheduledAt}
  onChange={(event) => onDraftScheduledAtChange(event.target.value)}
  aria-describedby={scheduledAtHelperId}
/>

// 之后
<DateTimePicker
  label={t("supervisor.field.scheduled_at")}
  value={draftScheduledAt}
  onValueChange={onDraftScheduledAtChange}
  placeholder={t("supervisor.field.scheduled_at_placeholder")}
  clearable
  minDate={new Date()}
  aria-describedby={scheduledAtHelperId}
/>
```

### 4.2 保持现有协议

- `draftScheduledAt` 仍为 `YYYY-MM-DDTHH:mm` 格式的字符串
- `onDraftScheduledAtChange` 回调签名不变
- `parseDraftScheduledAt` 函数无需修改
- 提交时 `scheduledAt` 仍为时间戳或 `undefined`

## 5. 测试策略

### 5.1 单元测试

- 组件渲染正确
- 值变化时触发回调
- 清空功能工作正常
- 日期限制生效
- 桌面端 Popover 打开/关闭
- 移动端 Sheet 打开/关闭
- 键盘导航
- 无障碍属性正确

### 5.2 集成测试

- 在 Supervisor 表单中使用
- 值正确传递到父组件
- 提交时 payload 正确

## 6. 国际化

### 6.1 新增翻译 Key

```json
{
  "datetime": {
    "today": "Today",
    "tomorrow": "Tomorrow",
    "next_week": "Next Week",
    "clear": "Clear",
    "confirm": "Confirm",
    "select_date": "Select Date",
    "select_time": "Select Time",
    "january": "January",
    "february": "February"
  }
}
```

### 6.2 日期显示格式

使用现有 `formatDate` 函数，根据当前 locale 显示日期：
- 中文：2026年5月11日 14:30
- 英文：May 11, 2026, 2:30 PM

## 7. 后续扩展

### 7.1 可能的扩展点

- 日期范围选择（DateRangePicker）
- 时间范围选择（TimeRangePicker）
- 年份选择器
- 月份选择器
- 自定义日期格式

### 7.2 不在当前范围

这些扩展点留待后续需求驱动时再设计实现。
