import type {
  SystemDependencyId,
  SystemDependencyInstallJobSnapshot,
  SystemDependencyInstallOutputChunk,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";

export function useSystemDependencyInstaller(onSucceeded: () => Promise<void>) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const [job, setJob] = useState<SystemDependencyInstallJobSnapshot | null>(null);
  const [output, setOutput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, setPendingDependencyId] = useState<SystemDependencyId | null>(null);
  const jobRef = useRef<SystemDependencyInstallJobSnapshot | null>(null);
  const pendingDependencyIdRef = useRef<SystemDependencyId | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const clearPollTimer = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const schedulePoll = (jobId: string) => {
    clearPollTimer();
    pollTimerRef.current = window.setTimeout(() => {
      void poll(jobId);
    }, 50);
  };

  const isActiveJobStatus = (status: SystemDependencyInstallJobSnapshot["status"]) =>
    status === "queued" || status === "running" || status === "waiting_input";

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

  const poll = async (jobId: string) => {
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.get", {
      jobId,
    });

    if (!result.ok || !result.data) {
      setPendingDependency(null);
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
      await onSucceeded();
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

  const start = async (dependencyId: SystemDependencyId) => {
    if (isInstallingDependency(dependencyId)) {
      if (jobRef.current) {
        schedulePoll(jobRef.current.jobId);
      }
      return;
    }

    clearPollTimer();
    setPendingDependency(dependencyId);
    setOutput("");

    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.start", {
      dependencyId,
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
    });
    if (result.ok && result.data) {
      setCurrentJob(result.data);
    }
  };

  return { job, output, submitting, start, submitInput, cancel, isInstallingDependency };
}
