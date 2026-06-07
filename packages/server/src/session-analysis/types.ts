export type SessionAnalysisStatus = "idle" | "running" | "succeeded" | "failed";

export interface SessionAnalysisRepeatedTopic {
  topic: string;
  whyItRepeated: string;
  evidence: string[];
}

export interface SessionAnalysisBottleneck {
  title: string;
  impact: string;
  evidence: string[];
  suggestion: string;
}

export interface SessionAnalysisSkillCandidate {
  title: string;
  why: string;
  suggestedScope: string;
  evidence: string[];
}

export interface SessionAnalysisResult {
  summary: string;
  recentWork: string[];
  repeatedTopics: SessionAnalysisRepeatedTopic[];
  bottlenecks: SessionAnalysisBottleneck[];
  skillCandidates: SessionAnalysisSkillCandidate[];
  openLoops: string[];
  wrapUpSuggestions: string[];
  confidence: "low" | "medium" | "high";
}

export interface SessionAnalysisRecord {
  sessionId: string;
  workspaceId: string;
  providerId: string;
  status: SessionAnalysisStatus;
  requestedAt?: number;
  completedAt?: number;
  inputDigest?: string;
  errorMessage?: string;
  result?: SessionAnalysisResult;
}

export interface SessionAnalysisContext {
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  providerId: string;
  sessionState: string;
  sessionTitle?: string;
  startedAt: number;
  lastActiveAt: number;
  endedAt?: number;
  gitStatus?: string;
  changedFiles: string[];
  diffSummary?: string;
  latestUserInput?: string;
  terminalSnapshot?: string;
}
