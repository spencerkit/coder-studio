# IconButton

Icon-only button primitive for legacy `.btn` callers that should expose an accessible label.

## Usage

```tsx
import { IconButton } from "@/components/ui";
import { X } from "lucide-react";

<IconButton aria-label="Close" icon={<X size={14} />} size="sm" variant="ghost" />;
```

`aria-label` is required. Use `variant="ghost"` for legacy modal/dialog close buttons and
`variant="filled"` only when the old caller behaved like a compact filled button.
