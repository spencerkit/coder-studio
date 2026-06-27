import type {
  SystemDependencyId,
  SystemDependencyInstallJobSnapshot,
  SystemDependencyInstallOutputChunk,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { activationStatusAtom } from "../../../atoms/activation";
import { connectionStatusAtom, dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";

export function useSystemDependencyInstaller(
  workspaceId: string | null | undefined,
  onSucceeded: () => Promise<void>
) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const activationStatus = useAtomValue(activationStatusAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const [job, setJob] = useState<SystemDependencyInstallJobSnapshot | null>(null);
  const [output, setOutput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDependencyId, setPendingDependencyId] = useState<SystemDependencyId | null>(null);
  const jobRef = useRef<SystemDependencyInstallJobSnapshot | null>(null);
  const pendingDependencyIdRef = useRef<SystemDependencyId | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const dispatchRef = useRef(dispatch);
  const onSucceededRef = useRef(onSucceeded);
  const canResumePollingRef = useRef(false);
  const pollRef = useRef<((jobId: string) => Promise<void>) | null>(null);

  dispatchRef.current = dispatch;
  onSucceededRef.current = onSucceeded;
  canResumePollingRef.current =
    activationStatus === "active" && connectionStatus === "connected" && wsClient !== null;

  const clearPollTimer = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const schedulePoll = (jobId: string) => {
    clearPollTimer();
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      void pollRef.current?.(jobId);
    }, 50);
  };

  const isActiveJobStatus = (status: SystemDependencyInstallJobSnapshot["status"]) =>
    status === "queued" || status === "running" || status === "waiting_input";

  const isRetryablePollError = (
    errorCode: string | undefined,
    errorMessage: string | undefined
  ) => {
    if (errorCode === "no_client") {
      return true;
    }

    const haystack = `${errorCode ?? ""}\n${errorMessage ?? ""}`.toLowerCase();
    return haystack.includes("socket closed") || haystack.includes("websocket");
  };

  const hasActiveInstallRef = () => {
    const currentJob = jobRef.current;
    return (
      pendingDependencyIdRef.current !== null ||
      (currentJob !== null && isActiveJobStatus(currentJob.status))
    );
  };

  const setCurrentJob = (nextJob: SystemDependencyInstallJobSnapshot | null) => {
    jobRef.current = nextJob;
    setJob(nextJob);
  };

  const setPendingDependency = (dependencyId: SystemDependencyId | null) => {
    pendingDependencyIdRef.current = dependencyId;
    setPendingDependencyId(dependencyId);
  };

  const isInstallingDependency = (dependencyId: SystemDependencyId) =>
    pendingDependencyIdRef.current === dependencyId ||
    (jobRef.current?.dependencyId === dependencyId && isActiveJobStatus(jobRef.current.status));
  const hasActiveInstall =
    pendingDependencyId !== null || (job !== null && isActiveJobStatus(job.status));

  pollRef.current = async (jobId: string) => {
    const result = await dispatchRef.current<SystemDependencyInstallJobSnapshot>(
      "systemDeps.install.get",
      {
        jobId,
        workspaceId: workspaceId ?? undefined,
      }
    );

    if (!result.ok || !result.data) {
      setPendingDependency(null);
      if (
        canResumePollingRef.current &&
        isRetryablePollError(result.error?.code, result.error?.message) &&
        jobRef.current?.jobId === jobId &&
        isActiveJobStatus(jobRef.current.status)
      ) {
        schedulePoll(jobId);
      }
      return;
    }

    setPendingDependency(null);
    setCurrentJob(result.data);

    if (isActiveJobStatus(result.data.status)) {
      schedulePoll(jobId);
      return;
    }

    if (result.data.status === "succeeded") {
      clearPollTimer();
      await onSucceededRef.current();
      setCurrentJob(null);
      setOutput("");
    }
  };

  useEffect(() => {
    return () => {
      clearPollTimer();
    };
  }, []);

  useEffect(() => {
    if (!job || !wsClient) {
      return;
    }

    return wsClient.subscribe(
      [Topics.systemDependencyInstallOutput(job.jobId)],
      (_topic, payload) => {
        const chunk = payload as SystemDependencyInstallOutputChunk;
        setOutput((previous) => `${previous}${chunk.chunk}`);
      }
    );
  }, [job, wsClient]);

  useEffect(() => {
    if (!canResumePollingRef.current) {
      return;
    }

    const currentJob = jobRef.current;
    if (!currentJob || !isActiveJobStatus(currentJob.status) || pollTimerRef.current !== null) {
      return;
    }

    schedulePoll(currentJob.jobId);
  }, [activationStatus, connectionStatus, job, wsClient]);

  const start = async (dependencyId: SystemDependencyId) => {
    if (hasActiveInstallRef()) {
      if (isInstallingDependency(dependencyId) && jobRef.current) {
        schedulePoll(jobRef.current.jobId);
      }
      return;
    }

    clearPollTimer();
    setPendingDependency(dependencyId);
    setOutput("");

    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.start", {
      dependencyId,
      workspaceId: workspaceId ?? undefined,
    });
    if (!result.ok || !result.data) {
      setPendingDependency(null);
      return;
    }

    setPendingDependency(null);
    setCurrentJob(result.data);

    if (isActiveJobStatus(result.data.status)) {
      schedulePoll(result.data.jobId);
      return;
    }

    if (result.data.status === "succeeded") {
      await onSucceeded();
      setCurrentJob(null);
      setOutput("");
    }
  };

  const submitInput = async (text: string) => {
    const currentJob = jobRef.current;
    if (!currentJob) {
      return;
    }

    setSubmitting(true);
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.input", {
      jobId: currentJob.jobId,
      text,
      workspaceId: workspaceId ?? undefined,
    });
    setSubmitting(false);

    if (!result.ok || !result.data) {
      setPendingDependency(null);
      return;
    }

    setPendingDependency(null);
    setCurrentJob(result.data);
    if (isActiveJobStatus(result.data.status)) {
      schedulePoll(result.data.jobId);
      return;
    }

    if (result.data.status === "succeeded") {
      await onSucceeded();
      setCurrentJob(null);
      setOutput("");
    }
  };

  const cancel = async () => {
    const currentJob = jobRef.current;
    if (!currentJob) {
      return;
    }

    clearPollTimer();
    setPendingDependency(null);
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.cancel", {
      jobId: currentJob.jobId,
      workspaceId: workspaceId ?? undefined,
    });
    if (result.ok && result.data) {
      setCurrentJob(result.data);
    }
  };

  return { job, output, submitting, start, submitInput, cancel, hasActiveInstall };
}
