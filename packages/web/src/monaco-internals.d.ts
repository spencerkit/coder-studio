declare module "monaco-editor/esm/vs/editor/browser/services/codeEditorService.js" {
  export const ICodeEditorService: unknown;
}

declare module "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js" {
  export const StandaloneServices: {
    get(serviceId: unknown): unknown;
  };
}
