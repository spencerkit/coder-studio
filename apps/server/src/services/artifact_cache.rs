use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};

use crate::ExecTarget;

#[derive(Clone)]
pub(crate) struct TimedCacheEntry<T> {
    pub value: T,
    pub fresh_until: Instant,
}

pub(crate) type TimedCache<T> = Arc<Mutex<HashMap<String, TimedCacheEntry<T>>>>;

fn target_cache_key(target: &ExecTarget) -> String {
    match target {
        ExecTarget::Native => "native".to_string(),
        ExecTarget::Wsl { distro } => format!("wsl:{}", distro.as_deref().unwrap_or("").trim()),
    }
}

pub(crate) fn artifact_cache_key(
    kind: &str,
    path: &str,
    target: &ExecTarget,
    variant: Option<&str>,
) -> String {
    let base = format!("{kind}::{}::{path}", target_cache_key(target));
    match variant {
        Some(variant) if !variant.trim().is_empty() => format!("{base}::{variant}"),
        _ => base,
    }
}

pub(crate) fn cache_lookup<T: Clone>(
    cache: &TimedCache<T>,
    key: &str,
    now: Instant,
) -> Option<T> {
    let Ok(mut guard) = cache.lock() else {
        return None;
    };
    match guard.get(key) {
        Some(entry) if entry.fresh_until > now => Some(entry.value.clone()),
        Some(_) => {
            guard.remove(key);
            None
        }
        None => None,
    }
}

pub(crate) fn cache_store<T>(
    cache: &TimedCache<T>,
    key: String,
    value: T,
    fresh_until: Instant,
) {
    let Ok(mut guard) = cache.lock() else {
        return;
    };
    guard.insert(
        key,
        TimedCacheEntry {
            value,
            fresh_until,
        },
    );
}

pub(crate) fn invalidate_cache_entry<T>(cache: &TimedCache<T>, key: &str) {
    let Ok(mut guard) = cache.lock() else {
        return;
    };
    guard.remove(key);
}

pub(crate) fn invalidate_cache_prefix<T>(cache: &TimedCache<T>, prefix: &str) {
    let Ok(mut guard) = cache.lock() else {
        return;
    };
    guard.retain(|key, _| !key.starts_with(prefix));
}

#[cfg(test)]
mod tests {
    use super::{
        artifact_cache_key, cache_lookup, cache_store, invalidate_cache_entry, TimedCacheEntry,
    };
    use crate::ExecTarget;
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    #[test]
    fn cache_lookup_returns_none_after_expiry() {
        let cache = Arc::new(Mutex::new(HashMap::new()));
        cache_store(
            &cache,
            "workspace".to_string(),
            "value".to_string(),
            Instant::now() - Duration::from_millis(1),
        );

        assert_eq!(cache_lookup(&cache, "workspace", Instant::now()), None);
    }

    #[test]
    fn invalidate_cache_entry_removes_a_cached_value() {
        let cache = Arc::new(Mutex::new(HashMap::<String, TimedCacheEntry<String>>::new()));
        cache_store(
            &cache,
            "workspace".to_string(),
            "value".to_string(),
            Instant::now() + Duration::from_secs(1),
        );

        invalidate_cache_entry(&cache, "workspace");

        assert_eq!(cache_lookup(&cache, "workspace", Instant::now()), None);
    }

    #[test]
    fn artifact_cache_key_includes_kind_target_path_and_variant() {
        assert_eq!(
            artifact_cache_key("workspace_tree", "/tmp/repo", &ExecTarget::Native, Some("4")),
            "workspace_tree::native::/tmp/repo::4"
        );
    }
}
