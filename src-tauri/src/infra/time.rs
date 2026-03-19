use crate::*;

pub(crate) fn now_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn now_label() -> String {
    use chrono::Local;
    Local::now().format("%H:%M").to_string()
}

pub(crate) fn default_idle_policy() -> IdlePolicy {
    IdlePolicy {
        enabled: true,
        idle_minutes: 10,
        max_active: 3,
        pressure: true,
    }
}

pub(crate) fn mode_label(mode: &SessionMode) -> &'static str {
    match mode {
        SessionMode::Branch => "branch",
        SessionMode::GitTree => "git_tree",
    }
}

pub(crate) fn status_label(status: &SessionStatus) -> &'static str {
    match status {
        SessionStatus::Idle => "idle",
        SessionStatus::Running => "running",
        SessionStatus::Background => "background",
        SessionStatus::Waiting => "waiting",
        SessionStatus::Suspended => "suspended",
        SessionStatus::Queued => "queued",
        SessionStatus::Interrupted => "interrupted",
    }
}
