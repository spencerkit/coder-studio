import type {
  DiagnosticsCheck,
  DiagnosticsContext,
  DiagnosticsRequest,
  DiagnosticsResponse,
  ProviderRuntimeStatusEntry,
} from "@coder-studio/core";
import { z } from "zod";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { buildSystemDependencyRuntimeStatus } from "../system-deps/runtime-status.js";
import { validatePath } from "../workspace/validator.js";
import { type CommandContext, registerCommand } from "../ws/dispatch.js";

const DiagnosticsRequestSchema = z.object({
  context: z.enum(["workspace_open", "session_start", "mobile_continue", "manual_check"]),
  workspaceId: z.string().optional(),
  workspacePath: z.string().optional(),
  providerId: z.string().optional(),
});

function isLoopbackHost(host: string | undefined): boolean {
  return (
    host === undefined ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  );
}

async function resolveWorkspacePathCheck(
  workspacePath: string | undefined
): Promise<{ canContinue: boolean; checks: DiagnosticsCheck[] }> {
  if (!workspacePath) {
    return {
      canContinue: false,
      checks: [
        {
          id: "workspace-selection",
          code: "workspace_selection_missing",
          status: "needs_attention",
        },
      ],
    };
  }

  const validation = await validatePath(workspacePath);

  if (validation.valid) {
    return {
      canContinue: true,
      checks: [
        {
          id: "workspace-path",
          code: "workspace_path_ready",
          status: "ready",
          workspacePath,
        },
      ],
    };
  }

  return {
    canContinue: false,
    checks: [
      {
        id: "workspace-path",
        code:
          validation.error === "Path does not exist"
            ? "workspace_path_not_found"
            : "workspace_path_unreadable",
        status: "needs_attention",
        workspacePath,
      },
    ],
  };
}

function buildProviderCheck(
  providerStatus: ProviderRuntimeStatusEntry,
  providerId: string
): { canContinue: boolean; checks: DiagnosticsCheck[] } {
  if (providerStatus.available) {
    return {
      canContinue: true,
      checks: [
        {
          id: `provider:${providerId}`,
          code: "provider_runtime_ready",
          status: "ready",
          providerId,
          autoInstallSupported: providerStatus.autoInstallSupported,
          installReadiness: providerStatus.installReadiness,
        },
      ],
    };
  }

  if (providerStatus.missingPrerequisites.length > 0) {
    return {
      canContinue: false,
      checks: [
        {
          id: `provider:${providerId}`,
          code: "provider_prerequisite_missing",
          status: "needs_attention",
          providerId,
          autoInstallSupported: providerStatus.autoInstallSupported,
          installReadiness: providerStatus.installReadiness,
          missingCommands: providerStatus.missingCommands,
          missingPrerequisites: providerStatus.missingPrerequisites,
          manualGuideKeys: providerStatus.manualGuideKeys,
          docUrl: providerStatus.docUrls.provider,
        },
      ],
    };
  }

  return {
    canContinue: false,
    checks: [
      {
        id: `provider:${providerId}`,
        code: "provider_cli_missing",
        status: "needs_attention",
        providerId,
        autoInstallSupported: providerStatus.autoInstallSupported,
        installReadiness: providerStatus.installReadiness,
        missingCommands: providerStatus.missingCommands,
        missingPrerequisites: providerStatus.missingPrerequisites,
        manualGuideKeys: providerStatus.manualGuideKeys,
        docUrl: providerStatus.docUrls.provider,
      },
    ],
  };
}

async function buildWorkspaceSelectionChecks(
  args: DiagnosticsRequest,
  ctx: CommandContext
): Promise<{ canContinue: boolean; checks: DiagnosticsCheck[]; workspacePath?: string }> {
  if (args.workspacePath) {
    const workspaceResult = await resolveWorkspacePathCheck(args.workspacePath);
    return {
      canContinue: workspaceResult.canContinue,
      checks: workspaceResult.checks,
      workspacePath: args.workspacePath,
    };
  }

  const workspace = args.workspaceId ? ctx.workspaceMgr.get(args.workspaceId) : undefined;
  if (!args.workspaceId) {
    return {
      canContinue: true,
      checks: [],
    };
  }

  if (!workspace) {
    return {
      canContinue: false,
      checks: [
        {
          id: "session-workspace",
          code: "session_workspace_missing",
          status: "needs_attention",
          workspaceId: args.workspaceId,
        },
      ],
    };
  }

  const pathCheck = await resolveWorkspacePathCheck(workspace.path);
  return {
    canContinue: pathCheck.canContinue,
    checks: [
      {
        id: "session-workspace",
        code: "session_workspace_ready",
        status: "ready",
        workspaceId: workspace.id,
        workspacePath: workspace.path,
      },
      ...pathCheck.checks.map((check) =>
        check.id === "workspace-path"
          ? {
              ...check,
              id: `workspace-path:${workspace.id}`,
            }
          : check
      ),
    ],
    workspacePath: workspace.path,
  };
}

async function buildAllProviderChecks(
  ctx: CommandContext,
  preferredProviderId?: string
): Promise<{
  checks: DiagnosticsCheck[];
  canContinueForPreferredProvider: boolean;
}> {
  const checks: DiagnosticsCheck[] = [];
  let canContinueForPreferredProvider = preferredProviderId ? false : true;
  const runtimeStatus = await buildProviderRuntimeStatus(
    ctx.providerRegistry,
    ctx.providerRuntimeDeps
  );

  for (const provider of ctx.providerRegistry) {
    const providerStatus = runtimeStatus.providers[provider.id];
    if (!providerStatus) {
      checks.push({
        id: `provider:${provider.id}`,
        code: "provider_unknown",
        status: "needs_attention",
        providerId: provider.id,
      });

      if (provider.id === preferredProviderId) {
        canContinueForPreferredProvider = false;
      }
      continue;
    }

    const providerCheck = buildProviderCheck(providerStatus, provider.id);
    checks.push(...providerCheck.checks);

    if (provider.id === preferredProviderId) {
      canContinueForPreferredProvider = providerCheck.canContinue;
    }
  }

  if (
    preferredProviderId &&
    !ctx.providerRegistry.find((provider) => provider.id === preferredProviderId)
  ) {
    checks.unshift({
      id: "session-provider",
      code: "provider_unknown",
      status: "needs_attention",
      providerId: preferredProviderId,
    });
    canContinueForPreferredProvider = false;
  }

  return { checks, canContinueForPreferredProvider };
}

function buildServerAuthCheck(ctx: CommandContext): DiagnosticsCheck {
  return {
    id: "server-auth",
    code: ctx.config?.auth.enabled ? "server_auth_ready" : "server_auth_not_required",
    status: "ready",
  };
}

function buildMobileHostCheck(ctx: CommandContext): {
  canContinue: boolean;
  check: DiagnosticsCheck;
} {
  if (isLoopbackHost(ctx.config?.host)) {
    return {
      canContinue: false,
      check: {
        id: "mobile-host",
        code: "mobile_host_local_only",
        status: "needs_attention",
      },
    };
  }

  return {
    canContinue: true,
    check: {
      id: "mobile-host",
      code: "mobile_host_ready",
      status: "ready",
    },
  };
}

async function buildBaseRuntimeChecks(
  ctx: CommandContext
): Promise<{ canContinue: boolean; checks: DiagnosticsCheck[] }> {
  const runtime = await buildSystemDependencyRuntimeStatus(ctx.providerRuntimeDeps);
  const git = runtime.dependencies.git;
  const node = runtime.dependencies.node;
  return {
    canContinue: git.available && node.available,
    checks: [
      {
        id: "runtime:git",
        code: git.available ? "git_ready" : "git_missing",
        status: git.available ? "ready" : "needs_attention",
        dependencyId: "git",
        autoInstallSupported: git.autoInstallSupported,
        installReadiness: git.installReadiness,
        manualGuideKeys: git.manualGuideKeys,
        docUrl: git.docUrl,
        version: git.version,
      },
      {
        id: "runtime:nodejs",
        code: node.available ? "nodejs_ready" : "nodejs_missing",
        status: node.available ? "ready" : "needs_attention",
        dependencyId: "node",
        autoInstallSupported: node.autoInstallSupported,
        installReadiness: node.installReadiness,
        manualGuideKeys: node.manualGuideKeys,
        docUrl: node.docUrl,
        version: node.version,
      },
    ],
  };
}

async function buildSessionStartDiagnostics(
  args: DiagnosticsRequest,
  ctx: CommandContext
): Promise<DiagnosticsResponse> {
  const workspaceSelection = await buildWorkspaceSelectionChecks(args, ctx);
  const baseRuntime = await buildBaseRuntimeChecks(ctx);
  const providerChecks = await buildAllProviderChecks(ctx, args.providerId);
  const mobileHost = buildMobileHostCheck(ctx);
  const checks: DiagnosticsCheck[] = [
    ...workspaceSelection.checks,
    ...baseRuntime.checks,
    ...providerChecks.checks,
    buildServerAuthCheck(ctx),
    mobileHost.check,
  ];
  const canContinue =
    workspaceSelection.canContinue &&
    baseRuntime.canContinue &&
    providerChecks.canContinueForPreferredProvider;

  return {
    context: "session_start",
    canContinue,
    checks,
    metadata: {
      providerId: args.providerId,
      workspaceId: args.workspaceId,
      workspacePath: workspaceSelection.workspacePath,
      authEnabled: ctx.config?.auth.enabled ?? false,
      host: ctx.config?.host,
    },
  };
}

async function buildManualDiagnostics(
  args: DiagnosticsRequest,
  ctx: CommandContext
): Promise<DiagnosticsResponse> {
  const baseRuntime = await buildBaseRuntimeChecks(ctx);
  const providerChecks = await buildAllProviderChecks(ctx, args.providerId);
  const mobileHost = buildMobileHostCheck(ctx);
  const checks: DiagnosticsCheck[] = [
    ...baseRuntime.checks,
    ...providerChecks.checks,
    buildServerAuthCheck(ctx),
    mobileHost.check,
  ];

  return {
    context: "manual_check",
    canContinue: checks.every((check) => check.status !== "needs_attention"),
    checks,
    metadata: {
      authEnabled: ctx.config?.auth.enabled ?? false,
      host: ctx.config?.host,
      providerId: args.providerId,
      workspaceId: args.workspaceId,
      workspacePath: args.workspacePath,
    },
  };
}

async function buildMobileDiagnostics(
  args: DiagnosticsRequest,
  ctx: CommandContext
): Promise<DiagnosticsResponse> {
  const host = ctx.config?.host;
  const authEnabled = ctx.config?.auth.enabled ?? false;
  const workspaceSelection = await buildWorkspaceSelectionChecks(args, ctx);
  const providerChecks = await buildAllProviderChecks(ctx, args.providerId);
  const mobileHost = buildMobileHostCheck(ctx);
  const checks: DiagnosticsCheck[] = [
    ...workspaceSelection.checks,
    ...providerChecks.checks,
    buildServerAuthCheck(ctx),
    mobileHost.check,
  ];
  let canContinue = mobileHost.canContinue;

  if (!authEnabled) {
    canContinue = false;
    checks.push({
      id: "mobile-auth",
      code: "mobile_auth_disabled",
      status: "needs_attention",
    });
  } else {
    checks.push({
      id: "mobile-auth",
      code: "server_auth_ready",
      status: "ready",
    });
  }

  return {
    context: "mobile_continue",
    canContinue,
    checks,
    metadata: {
      authEnabled,
      host,
      workspaceId: args.workspaceId,
      workspacePath: workspaceSelection.workspacePath,
      providerId: args.providerId,
    },
  };
}

async function buildDiagnostics(
  args: DiagnosticsRequest,
  ctx: CommandContext
): Promise<DiagnosticsResponse> {
  switch (args.context as DiagnosticsContext) {
    case "workspace_open": {
      const workspaceSelection = await buildWorkspaceSelectionChecks(args, ctx);
      const baseRuntime = await buildBaseRuntimeChecks(ctx);
      const providerChecks = await buildAllProviderChecks(ctx, args.providerId);
      const mobileHost = buildMobileHostCheck(ctx);
      return {
        context: "workspace_open",
        canContinue: workspaceSelection.canContinue,
        checks: [
          ...workspaceSelection.checks,
          ...baseRuntime.checks,
          ...providerChecks.checks,
          buildServerAuthCheck(ctx),
          mobileHost.check,
        ],
        metadata: {
          workspacePath: workspaceSelection.workspacePath ?? args.workspacePath,
          authEnabled: ctx.config?.auth.enabled ?? false,
          host: ctx.config?.host,
          providerId: args.providerId,
          workspaceId: args.workspaceId,
        },
      };
    }
    case "session_start":
      return buildSessionStartDiagnostics(args, ctx);
    case "mobile_continue":
      return buildMobileDiagnostics(args, ctx);
    case "manual_check":
      return buildManualDiagnostics(args, ctx);
  }
}

registerCommand("diagnostics.get", DiagnosticsRequestSchema, async (args, ctx) => {
  return buildDiagnostics(args, ctx);
});

registerCommand("diagnostics.recheck", DiagnosticsRequestSchema, async (args, ctx) => {
  return buildDiagnostics(args, ctx);
});
