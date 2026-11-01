//! Per-project edit locks (proposal 0004, server half).
//!
//! One editor per project at a time: the first client to edit a project holds
//! its lock, everyone else reads and follows. Locks live only in server
//! memory — a restart frees every project — and the UI is never trusted, so
//! the write paths (0004.2) enforce them server-side.
//!
//! A lock is a short lease plus an idle timer:
//!
//! * **Lease** (`LEASE_DURATION`): renewed by the holder's heartbeats while
//!   its tab is open. A crashed tab stops heartbeating, so the project frees
//!   itself when the lease runs out.
//! * **Idle release** (`IDLE_TIMEOUT`): the lock also frees after a minute
//!   without edits, so an abandoned tab does not block the project. Heartbeats
//!   renew the lease but never touch the idle timer — only real edits do
//!   (0004.2), which is what makes an abandoned-yet-open tab let go.
//!
//! Identity is a proof of concept: the web client keeps its username in
//! `localStorage` and sends it as `USER_HEADER`; the server trusts it.
//! There is no authentication and no override — a stuck lock clears itself.
//!
//! Same-user tabs share one holder string, so a second tab under the same
//! username renews rather than refuses: the PoC cannot tell tabs apart, and
//! self-lockout would be worse than sharing. A `user#tabId` suffix can be
//! adopted later without changing this protocol.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

/// How long one acquisition or heartbeat holds a project.
pub const LEASE_DURATION: Duration = Duration::from_secs(15);

/// No edits for this long frees a project, even while heartbeats arrive.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// Trusted `PoC` identity header: the username the web client keeps in
/// `localStorage`. MCP clients never send it — they are hardcoded to `AI`
/// server-side (0004.4).
pub const USER_HEADER: &str = "x-rhizz-user";

/// One held project lock.
#[derive(Debug, Clone)]
struct Lock {
    /// The username that holds the project.
    holder: String,
    /// When the lease runs out without a heartbeat.
    lease_expires: Instant,
    /// When the holder last edited (acquiring counts as an edit).
    last_edit: Instant,
}

impl Lock {
    /// Whether the lock still blocks other users at `now`.
    fn live(&self, now: Instant) -> bool {
        now < self.lease_expires && now.saturating_duration_since(self.last_edit) < IDLE_TIMEOUT
    }
}

/// The instant a lease taken at `now` runs out, falling back to `now`
/// itself on overflow (which would mean the clock is centuries out) rather
/// than panicking.
fn lease_expiry(now: Instant) -> Instant {
    now.checked_add(LEASE_DURATION).unwrap_or(now)
}

/// What is reported to watchers polling a project's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockInfo {
    /// The username holding the project.
    pub holder: String,
    /// When the lease runs out without another heartbeat.
    pub expires_at: SystemTime,
}

/// The outcome of trying to take a project's lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AcquireOutcome {
    /// The project was free (or its lock had lapsed) and is now held.
    Acquired,
    /// The same user already held it; the lease was renewed.
    Renewed,
    /// Someone else holds it; carries their username.
    Refused {
        /// The username holding the project.
        holder: String,
    },
}

/// The outcome of a heartbeat from the lock holder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeartbeatOutcome {
    /// The lease was renewed.
    Renewed,
    /// The project is not held by this user; carries the current holder, if
    /// any. The client must re-acquire through the lock endpoint.
    NotHeld {
        /// The username holding the project, or `None` when it is free.
        holder: Option<String>,
    },
}

/// In-memory holder of every project's lock, shared across handlers.
#[derive(Debug, Clone, Default)]
pub struct LockManager {
    /// Project id to its lock; entries are pruned once they lapse.
    inner: Arc<Mutex<HashMap<String, Lock>>>,
}

impl LockManager {
    /// Creates an empty manager: no project is locked.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Takes (or renews) the lock on `project` for `user` at this instant.
    #[must_use]
    pub fn acquire(&self, project: &str, user: &str) -> AcquireOutcome {
        self.acquire_at(project, user, Instant::now())
    }

    /// Takes (or renews) the lock on `project` for `user` at `now`.
    fn acquire_at(&self, project: &str, user: &str, now: Instant) -> AcquireOutcome {
        let mut locks = self.lock_or_poisoned();
        match locks.get(project).cloned() {
            Some(lock) if lock.live(now) && lock.holder != user => {
                return AcquireOutcome::Refused {
                    holder: lock.holder,
                };
            }
            Some(lock) if lock.live(now) => {
                locks.insert(
                    project.to_owned(),
                    Lock {
                        holder: user.to_owned(),
                        lease_expires: lease_expiry(now),
                        last_edit: lock.last_edit,
                    },
                );
                return AcquireOutcome::Renewed;
            }
            _ => {}
        }
        // Free, expired, or idle: acquiring counts as the first edit.
        locks.insert(
            project.to_owned(),
            Lock {
                holder: user.to_owned(),
                lease_expires: lease_expiry(now),
                last_edit: now,
            },
        );
        AcquireOutcome::Acquired
    }

    /// Renews the lease on `project` for `user` without touching the idle
    /// timer: heartbeats keep a live tab's lock, but never rescue an idle
    /// one.
    #[must_use]
    pub fn heartbeat(&self, project: &str, user: &str) -> HeartbeatOutcome {
        self.heartbeat_at(project, user, Instant::now())
    }

    /// Renews the lease on `project` for `user` at `now`.
    fn heartbeat_at(&self, project: &str, user: &str, now: Instant) -> HeartbeatOutcome {
        let mut locks = self.lock_or_poisoned();
        let outcome = match locks.get(project).cloned() {
            Some(lock) if lock.live(now) && lock.holder == user => {
                locks.insert(
                    project.to_owned(),
                    Lock {
                        holder: user.to_owned(),
                        lease_expires: lease_expiry(now),
                        last_edit: lock.last_edit,
                    },
                );
                HeartbeatOutcome::Renewed
            }
            Some(lock) if lock.live(now) => HeartbeatOutcome::NotHeld {
                holder: Some(lock.holder),
            },
            _ => {
                locks.remove(project);
                HeartbeatOutcome::NotHeld { holder: None }
            }
        };
        drop(locks);
        outcome
    }

    /// Reports who holds `project`, if anyone, at this instant.
    #[must_use]
    pub fn get(&self, project: &str) -> Option<LockInfo> {
        self.get_at(project, Instant::now())
    }

    /// Reports who holds `project`, if anyone, at `now`, pruning lapsed
    /// entries so idle and expired locks free their project on read.
    fn get_at(&self, project: &str, now: Instant) -> Option<LockInfo> {
        let mut locks = self.lock_or_poisoned();
        let lock = locks.get(project).cloned()?;
        if !lock.live(now) {
            locks.remove(project);
            drop(locks);
            return None;
        }
        let remaining = lock.lease_expires.saturating_duration_since(now);
        drop(locks);
        // `checked_add` only overflows centuries out; either way the expiry
        // is a hint and the live-lock check above is authoritative.
        let expires_at = SystemTime::now()
            .checked_add(remaining)
            .unwrap_or_else(SystemTime::now);
        Some(LockInfo {
            holder: lock.holder,
            expires_at,
        })
    }

    /// Locks the map, carrying a poisoned mutex through rather than
    /// deadlocking the server on a previous panic.
    fn lock_or_poisoned(&self) -> std::sync::MutexGuard<'_, HashMap<String, Lock>> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One manager with `project` held by `user` at `start`.
    fn held_at(project: &str, user: &str, start: Instant) -> LockManager {
        let manager = LockManager::new();
        assert!(matches!(
            manager.acquire_at(project, user, start),
            AcquireOutcome::Acquired
        ));
        manager
    }

    #[test]
    fn acquire_on_a_free_project_is_acquired() {
        let manager = LockManager::new();
        assert!(manager.get("drone").is_none());

        assert!(matches!(
            manager.acquire("drone", "alice"),
            AcquireOutcome::Acquired
        ));

        let info = manager.get("drone").expect("project must be locked");
        assert_eq!(info.holder, "alice");
        assert!(info.expires_at > SystemTime::now());
    }

    #[test]
    fn another_user_is_refused_with_the_holder_named() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        assert!(matches!(
            manager.acquire_at("drone", "bob", start),
            AcquireOutcome::Refused { ref holder } if holder == "alice"
        ));
        // The refusal changes nothing.
        assert_eq!(manager.get_at("drone", start).unwrap().holder, "alice");
    }

    #[test]
    fn same_user_reacquire_renews_the_lease() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        assert!(matches!(
            manager.acquire_at("drone", "alice", start + Duration::from_secs(5)),
            AcquireOutcome::Renewed
        ));

        // The original 15s lease would have lapsed at start + 15s; renewed at
        // start + 5s it lives until start + 20s.
        assert!(
            manager
                .get_at("drone", start + Duration::from_secs(16))
                .is_some()
        );
        assert!(
            manager
                .get_at("drone", start + Duration::from_secs(21))
                .is_none()
        );
    }

    #[test]
    fn an_expired_lease_frees_the_project() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        assert!(matches!(
            manager.acquire_at(
                "drone",
                "bob",
                start + LEASE_DURATION + Duration::from_secs(1)
            ),
            AcquireOutcome::Acquired
        ));
        assert_eq!(
            manager
                .get_at("drone", start + LEASE_DURATION + Duration::from_secs(1))
                .unwrap()
                .holder,
            "bob"
        );
    }

    #[test]
    fn idle_release_frees_the_project_despite_heartbeats() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        // Heartbeats keep renewing the lease (each within the previous one) …
        assert!(matches!(
            manager.heartbeat_at("drone", "alice", start + Duration::from_secs(10)),
            HeartbeatOutcome::Renewed
        ));
        assert!(matches!(
            manager.heartbeat_at("drone", "alice", start + Duration::from_secs(20)),
            HeartbeatOutcome::Renewed
        ));

        // … but a minute without edits still frees the project.
        let idle = start + IDLE_TIMEOUT + Duration::from_secs(1);
        assert!(manager.get_at("drone", idle).is_none());
        assert!(matches!(
            manager.acquire_at("drone", "bob", idle),
            AcquireOutcome::Acquired
        ));
    }

    #[test]
    fn heartbeat_does_not_reset_the_idle_timer() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        // Keep the lease alive with steady heartbeats.
        for secs in [10, 20, 30, 40, 50] {
            assert!(matches!(
                manager.heartbeat_at("drone", "alice", start + Duration::from_secs(secs)),
                HeartbeatOutcome::Renewed
            ));
        }
        // Still live at 55s: the lease runs to 65s and only 55s passed
        // without an edit …
        assert!(
            manager
                .get_at("drone", start + Duration::from_secs(55))
                .is_some()
        );
        // … but idle at 61s even though the lease would run to 65s.
        assert!(
            manager
                .get_at("drone", start + Duration::from_secs(61))
                .is_none()
        );
    }

    #[test]
    fn heartbeat_by_someone_else_is_not_held() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        assert!(matches!(
            manager.heartbeat_at("drone", "bob", start),
            HeartbeatOutcome::NotHeld { ref holder } if holder.as_deref() == Some("alice")
        ));
    }

    #[test]
    fn heartbeat_on_a_free_project_is_not_held() {
        let manager = LockManager::new();
        assert!(matches!(
            manager.heartbeat("drone", "alice"),
            HeartbeatOutcome::NotHeld { holder: None }
        ));
    }

    #[test]
    fn heartbeat_after_expiry_is_not_held_and_prunes() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        let after = start + LEASE_DURATION + Duration::from_secs(1);
        assert!(matches!(
            manager.heartbeat_at("drone", "alice", after),
            HeartbeatOutcome::NotHeld { holder: None }
        ));
        assert!(manager.get_at("drone", after).is_none());
    }

    #[test]
    fn locks_are_per_project() {
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        assert!(matches!(
            manager.acquire_at("web-app", "bob", start),
            AcquireOutcome::Acquired
        ));
        assert_eq!(manager.get_at("drone", start).unwrap().holder, "alice");
        assert_eq!(manager.get_at("web-app", start).unwrap().holder, "bob");
    }

    #[test]
    fn same_username_shares_the_holder_across_tabs() {
        // Documented PoC decision: two tabs under one username cannot tell
        // themselves apart, so the second tab renews instead of refusing —
        // self-lockout would be worse than sharing.
        let start = Instant::now();
        let manager = held_at("drone", "alice", start);

        assert!(matches!(
            manager.acquire_at("drone", "alice", start + Duration::from_secs(1)),
            AcquireOutcome::Renewed
        ));
    }
}
