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

  const poll = async (jobId: string) => {
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.get", {
      jobId,
    });

    if (!result.ok || !result.data) {
      return;
    }

    setJob(result.data);

    if (isActiveJobStatus(result.data.status)) {
      schedulePoll(jobId);
      return;
    }

    if (result.data.status === "succeeded") {
      clearPollTimer();
      await onSucceeded();
      setJob(null);
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
    clearPollTimer();
    setOutput("");

    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.start", {
      dependencyId,
    });
    if (!result.ok || !result.data) {
      return;
    }

    setJob(result.data);

    if (isActiveJobStatus(result.data.status)) {
      schedulePoll(result.data.jobId);
      return;
    }

    if (result.data.status === "succeeded") {
      await onSucceeded();
      setJob(null);
      setOutput("");
    }
  };

  const submitInput = async (text: string) => {
    if (!job) {
      return;
    }

    setSubmitting(true);
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.input", {
      jobId: job.jobId,
      text,
    });
    setSubmitting(false);

    if (!result.ok || !result.data) {
      return;
    }

    setJob(result.data);
    if (isActiveJobStatus(result.data.status)) {
      schedulePoll(result.data.jobId);
      return;
    }

    if (result.data.status === "succeeded") {
      await onSucceeded();
      setJob(null);
      setOutput("");
    }
  };

  const cancel = async () => {
    if (!job) {
      return;
    }

    clearPollTimer();
    const result = await dispatch<SystemDependencyInstallJobSnapshot>("systemDeps.install.cancel", {
      jobId: job.jobId,
    });
    if (result.ok && result.data) {
      setJob(result.data);
    }
  };

  return { job, output, submitting, start, submitInput, cancel };
}
