# Image Preview Zoom Design

## Scope

Improve the existing file image preview in `packages/web/src/features/code-editor/components/image-preview.tsx`.
The change is limited to the normal workspace image preview surface, not image diff or document preview.

## Behavior

- Add image zoom controls inside the preview chrome: zoom out, zoom in, fit to window, and show actual size.
- Keep the current metadata strip with image type, dimensions, and size.
- Show the current zoom percentage so the user can see the active scale.
- Support keyboard-modified wheel zoom on the image canvas with `Ctrl` or `Meta`.
- Clamp zoom between 25% and 400%.
- Reset zoom to fit mode when the image URL or version changes.

## UI

Use icon-only `IconButton` controls with `Tooltip`, matching the existing editor toolbar style.
The controls live in the image preview footer so they do not compete with the editor mode toolbar.
The image canvas remains the scroll container; when zoomed beyond the viewport, the user can scroll around the enlarged image.

## Testing

Add focused component tests for:

- Rendering zoom controls with accessible names.
- Zoom-in and zoom-out changing the percentage.
- Actual-size and fit controls switching the transform state.
- Version changes resetting the zoom state.

Run the image preview test file after implementation.
