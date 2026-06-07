import { mkdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { createOpenCodeWorkLogSource } from "../work-analysis/log-sources/opencode.js";

async function createDbFixture() {
  const home = await mkdtemp(join(tmpdir(), "opencode-home-"));
  const dir = join(home, ".local/share/opencode");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table project (
      id text primary key,
      worktree text not null,
      time_created integer not null,
      time_updated integer not null
    );
    create table session (
      id text primary key,
      project_id text not null,
      directory text not null,
      title text not null,
      version text not null,
      summary_files integer,
      summary_additions integer,
      summary_deletions integer,
      time_created integer not null,
      time_updated integer not null
    );
    create table message (
      id text primary key,
      session_id text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    create table part (
      id text primary key,
      message_id text not null,
      session_id text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    insert into project values ('proj-1', '/repo/app', 1000, 3000);
    insert into session values ('ses-1', 'proj-1', '/repo/app', 'Fix tests', '1.2.15', 2, 10, 1, 1000, 3000);
    insert into message values ('msg-1', 'ses-1', 1000, 1000, '{"role":"user","text":"fix"}');
    insert into message values ('msg-2', 'ses-1', 2000, 3000, '{"role":"assistant","text":"done"}');
    insert into part values ('part-1', 'msg-2', 'ses-1', 2500, 2500, '{"type":"tool","tool":"bash"}');
  `);
  db.close();
  return home;
}

async function createTokenDbFixture() {
  const home = await mkdtemp(join(tmpdir(), "opencode-home-"));
  const dir = join(home, ".local/share/opencode");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table project (
      id text primary key,
      worktree text not null,
      time_created integer not null,
      time_updated integer not null
    );
    create table session (
      id text primary key,
      project_id text not null,
      directory text not null,
      title text not null,
      version text not null,
      model_id text,
      cost real,
      tokens_input integer,
      tokens_output integer,
      tokens_reasoning integer,
      tokens_cache_read integer,
      tokens_cache_write integer,
      summary_files integer,
      summary_additions integer,
      summary_deletions integer,
      time_created integer not null,
      time_updated integer not null
    );
    create table message (
      id text primary key,
      session_id text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    create table part (
      id text primary key,
      message_id text not null,
      session_id text not null,
      time_created integer not null,
      time_updated integer not null,
      data text not null
    );
    insert into project values ('proj-1', '/repo/app', 1000, 5000);
    insert into session values (
      'ses-1',
      'proj-1',
      '/repo/app',
      'Implement tokens',
      '0.10.0',
      'anthropic/claude-sonnet-4',
      0.14,
      0,
      0,
      0,
      0,
      0,
      3,
      12,
      1,
      1000,
      5000
    );
    insert into session values (
      'ses-2',
      'proj-1',
      '/repo/app',
      'Session-level tokens',
      '0.10.0',
      'openai/gpt-5',
      0.09,
      1000,
      200,
      50,
      60,
      70,
      0,
      0,
      0,
      2000,
      4000
    );
    insert into message values ('msg-1', 'ses-1', 1000, 1000, '{"role":"user","text":"fix"}');
    insert into message values (
      'msg-2',
      'ses-1',
      2000,
      2000,
      '{"role":"assistant","modelID":"anthropic/claude-sonnet-4","tokens":{"input":120,"output":35,"reasoning":9,"cache":{"read":20,"write":30}},"cost":0.05}'
    );
    insert into message values (
      'msg-3',
      'ses-1',
      3000,
      3000,
      '{"role":"assistant","model":"anthropic/claude-sonnet-4","usage":{"input_tokens":80,"output_tokens":15,"cache_creation_input_tokens":5,"cache_read_input_tokens":7},"cost":0.03}'
    );
    insert into message values ('msg-4', 'ses-2', 3500, 3500, '{"role":"assistant","modelID":"openai/gpt-5"}');
    insert into part values ('part-1', 'msg-2', 'ses-1', 2500, 2500, '{"type":"tool","tool":"bash"}');
  `);
  db.close();
  return home;
}

describe("OpenCode work log source", () => {
  it("returns missing_root when the OpenCode database does not exist", async () => {
    const home = await mkdtemp(join(tmpdir(), "opencode-home-"));

    const result = await createOpenCodeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 0, endAt: 5_000, label: "custom" },
    });

    expect(result.status).toBe("missing_root");
    expect(result.sessions).toHaveLength(0);
    expect(result.sourceRefs).toHaveLength(0);
  });

  it("returns no_logs when the sqlite query finds no sessions in range", async () => {
    const home = await mkdtemp(join(tmpdir(), "opencode-home-"));
    const dir = join(home, ".local/share/opencode");
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "opencode.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      create table project (
        id text primary key,
        worktree text not null,
        time_created integer not null,
        time_updated integer not null
      );
      create table session (
        id text primary key,
        project_id text not null,
        directory text not null,
        title text not null,
        version text not null,
        time_created integer not null,
        time_updated integer not null
      );
      create table message (
        id text primary key,
        session_id text not null,
        time_created integer not null,
        time_updated integer not null,
        data text not null
      );
      create table part (
        id text primary key,
        message_id text not null,
        session_id text not null,
        time_created integer not null,
        time_updated integer not null,
        data text not null
      );
    `);
    db.close();

    const result = await createOpenCodeWorkLogSource({ home }).discover({
      timeRange: { startAt: 0, endAt: 5_000, label: "custom" },
    });

    expect(result.status).toBe("no_logs");
    expect(result.sessions).toHaveLength(0);
  });

  it("returns partial when the OpenCode database has an unsupported schema", async () => {
    const home = await mkdtemp(join(tmpdir(), "opencode-home-"));
    const dir = join(home, ".local/share/opencode");
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, "opencode.db");
    const db = new DatabaseSync(dbPath);
    db.exec("create table unrelated (id text primary key);");
    db.close();

    const result = await createOpenCodeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 0, endAt: 5_000, label: "custom" },
    });

    expect(result.status).toBe("partial");
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings[0]).toMatchObject({
      code: "sqlite_query_failed",
    });
  });

  it("reads sessions from the OpenCode SQLite database by workspace path", async () => {
    const home = await createDbFixture();

    const result = await createOpenCodeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 0, endAt: 5_000, label: "custom" },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      providerId: "opencode",
      sessionId: "ses-1",
      workspacePath: "/repo/app",
      title: "Fix tests",
      userTurnCount: 1,
      assistantTurnCount: 1,
      toolUseCount: 1,
      timestampQuality: "explicit",
    });
    expect(result.sourceRefs[0]).toMatchObject({
      providerId: "opencode",
      kind: "sqlite",
    });
  });

  it("extracts OpenCode token usage from assistant messages and session-level totals", async () => {
    const home = await createTokenDbFixture();

    const result = await createOpenCodeWorkLogSource({ home }).discover({
      workspacePaths: ["/repo/app"],
      timeRange: { startAt: 0, endAt: 5_000, label: "custom" },
    });

    expect(result.status).toBe("supported");
    expect(result.sessions).toHaveLength(2);

    const messageUsageSession = result.sessions.find((session) => session.sessionId === "ses-1");
    expect(messageUsageSession?.modelId).toBe("anthropic/claude-sonnet-4");
    expect(messageUsageSession?.usage).toEqual({
      inputTokens: 200,
      outputTokens: 50,
      cachedInputTokens: 27,
      cacheCreationInputTokens: 35,
      cacheReadInputTokens: 27,
      reasoningOutputTokens: 9,
      totalTokens: 312,
      estimatedCostUsd: 0.08,
    });
    expect(messageUsageSession?.usageCoverage).toMatchObject({
      hasUsage: true,
      callCount: 2,
      callsWithTotalTokens: 2,
      estimatedCallCount: 0,
    });
    expect(messageUsageSession?.usageCalls).toHaveLength(2);
    expect(
      messageUsageSession?.events?.filter((event) => event.eventType === "usage")
    ).toHaveLength(2);

    const sessionLevelUsage = result.sessions.find((session) => session.sessionId === "ses-2");
    expect(sessionLevelUsage?.modelId).toBe("openai/gpt-5");
    expect(sessionLevelUsage?.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 60,
      cacheCreationInputTokens: 70,
      cacheReadInputTokens: 60,
      reasoningOutputTokens: 50,
      totalTokens: 1330,
      estimatedCostUsd: 0.09,
    });
    expect(sessionLevelUsage?.usageCalls).toHaveLength(1);
    expect(sessionLevelUsage?.usageCalls?.[0]?.kind).toBe("assistant_message");
  });
});
