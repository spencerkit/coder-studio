use std::collections::HashMap;

const BLOCK_WINDOW_MS: i64 = 10 * 60 * 1000;
const BLOCK_DURATION_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, Default)]
pub(crate) struct IpGuardState {
    pub fail_count: u32,
    pub first_failed_at_ms: i64,
    pub last_failed_at_ms: i64,
    pub blocked_until_ms: i64,
}

pub(crate) type IpGuardMap = HashMap<String, IpGuardState>;

pub(crate) fn blocked_until(map: &mut IpGuardMap, ip: &str, now_ms: i64) -> Option<i64> {
    let state = map.get_mut(ip)?;
    if state.blocked_until_ms > now_ms {
        return Some(state.blocked_until_ms);
    }
    if state.blocked_until_ms != 0 || state.fail_count != 0 {
        map.remove(ip);
    }
    None
}

pub(crate) fn record_failure(map: &mut IpGuardMap, ip: &str, now_ms: i64) -> Option<i64> {
    if let Some(until) = blocked_until(map, ip, now_ms) {
        return Some(until);
    }

    let state = map.entry(ip.to_string()).or_default();
    if state.first_failed_at_ms == 0
        || now_ms.saturating_sub(state.first_failed_at_ms) > BLOCK_WINDOW_MS
    {
        state.fail_count = 1;
        state.first_failed_at_ms = now_ms;
        state.last_failed_at_ms = now_ms;
        state.blocked_until_ms = 0;
        return None;
    }

    state.fail_count = state.fail_count.saturating_add(1);
    state.last_failed_at_ms = now_ms;
    if state.fail_count >= 3 {
        state.blocked_until_ms = now_ms.saturating_add(BLOCK_DURATION_MS);
        return Some(state.blocked_until_ms);
    }
    None
}

pub(crate) fn clear_failures(map: &mut IpGuardMap, ip: &str) {
    map.remove(ip);
}
