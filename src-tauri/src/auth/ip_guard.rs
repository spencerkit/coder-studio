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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct IpBlockRecord {
    pub ip: String,
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

pub(crate) fn list_blocked(map: &mut IpGuardMap, now_ms: i64) -> Vec<IpBlockRecord> {
    let mut expired = Vec::new();
    let mut blocked = Vec::new();

    for (ip, state) in map.iter() {
        if state.blocked_until_ms > now_ms {
            blocked.push(IpBlockRecord {
                ip: ip.clone(),
                fail_count: state.fail_count,
                first_failed_at_ms: state.first_failed_at_ms,
                last_failed_at_ms: state.last_failed_at_ms,
                blocked_until_ms: state.blocked_until_ms,
            });
        } else if state.blocked_until_ms != 0 {
            expired.push(ip.clone());
        }
    }

    for ip in expired {
        map.remove(&ip);
    }

    blocked.sort_by(|left, right| left.ip.cmp(&right.ip));
    blocked
}

pub(crate) fn unblock_ip(map: &mut IpGuardMap, ip: &str) -> bool {
    map.remove(ip).is_some()
}

pub(crate) fn unblock_all(map: &mut IpGuardMap, now_ms: i64) -> usize {
    let blocked = list_blocked(map, now_ms);
    for entry in &blocked {
        map.remove(&entry.ip);
    }
    blocked.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_blocked_returns_active_entries_only() {
        let mut map = IpGuardMap::new();
        let now_ms = 1_000_000;
        map.insert(
            "10.0.0.1".to_string(),
            IpGuardState {
                fail_count: 3,
                first_failed_at_ms: now_ms - 100,
                last_failed_at_ms: now_ms - 50,
                blocked_until_ms: now_ms + 5_000,
            },
        );
        map.insert(
            "10.0.0.2".to_string(),
            IpGuardState {
                fail_count: 3,
                first_failed_at_ms: now_ms - 100,
                last_failed_at_ms: now_ms - 50,
                blocked_until_ms: now_ms - 1,
            },
        );
        map.insert(
            "10.0.0.3".to_string(),
            IpGuardState {
                fail_count: 2,
                first_failed_at_ms: now_ms - 100,
                last_failed_at_ms: now_ms - 50,
                blocked_until_ms: 0,
            },
        );

        let blocked = list_blocked(&mut map, now_ms);
        assert_eq!(blocked.len(), 1);
        assert_eq!(blocked[0].ip, "10.0.0.1");
        assert!(map.contains_key("10.0.0.1"));
        assert!(!map.contains_key("10.0.0.2"));
        assert!(map.contains_key("10.0.0.3"));
    }

    #[test]
    fn unblock_all_removes_only_blocked_entries() {
        let mut map = IpGuardMap::new();
        let now_ms = 1_000_000;
        map.insert(
            "10.0.0.1".to_string(),
            IpGuardState {
                fail_count: 3,
                first_failed_at_ms: now_ms - 100,
                last_failed_at_ms: now_ms - 50,
                blocked_until_ms: now_ms + 5_000,
            },
        );
        map.insert(
            "10.0.0.3".to_string(),
            IpGuardState {
                fail_count: 2,
                first_failed_at_ms: now_ms - 100,
                last_failed_at_ms: now_ms - 50,
                blocked_until_ms: 0,
            },
        );

        let removed = unblock_all(&mut map, now_ms);
        assert_eq!(removed, 1);
        assert!(!map.contains_key("10.0.0.1"));
        assert!(map.contains_key("10.0.0.3"));
    }
}
