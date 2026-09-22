//! Telemetry: removed.
//!
//! ZCode vendored this crate from trycua/cua and ships it as part of the
//! YCode desktop application, which must not report product usage anywhere.
//! The upstream module built PostHog payloads, persisted a pseudonymous
//! installation id under `~/.cua-driver/`, spooled pending events to disk and
//! spawned detached worker processes to deliver them over HTTPS.
//!
//! Every part of that pipeline is gone. What remains is an inert surface that
//! keeps the surrounding code compiling: the capture entry points are empty,
//! `is_enabled()` is `false`, and `status()` reports the removal. No outbound
//! request, no local identity file, no subprocess and no queue exists here.
//!
//! Call sites were deliberately left in place (they are no-ops) so that the
//! diff against upstream stays reviewable and a future upstream sync stays
//! mechanical. Grep for `telemetry::` to enumerate them; each one resolves to
//! an empty function in this file.
//!
//! `dead_code` is allowed because several entry points below exist only to keep
//! upstream call sites compiling, and some of those call sites are themselves
//! platform-gated (the permissions gate is macOS-only, the CLI transport is not
//! constructed on a telemetry-free Windows build).
#![allow(dead_code)]

use std::time::Duration;

/// Directories (current and pre-rename) that held upstream telemetry state
/// files under the user's home directory.
const HOME_SUBDIRECTORY: &str = ".cua-driver";
const LEGACY_HOME_SUBDIRECTORY: &str = ".cua-driver-rs";
const TELEMETRY_ID_FILE_NAME: &str = ".telemetry_id";
const TELEMETRY_RETRY_AFTER_FILE_NAME: &str = ".telemetry_retry_after";
const TELEMETRY_INSTALL_CHANNEL_FILE_NAME: &str = ".telemetry_install_channel";
const INSTALLATION_RECORDED_FILE_NAME: &str = ".installation_recorded";
const RELEASE_RECORDED_DIRECTORY: &str = ".release_installed";

/// Outcome of an update check, retained for `version_check` bookkeeping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UpdateCheckSource {
    Background,
    Cli,
    Mcp,
}

/// Result of an update check, retained for `version_check` bookkeeping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UpdateCheckOutcome {
    UpToDate,
    Available,
    Unavailable,
}

/// Result of applying an update, retained for `updater` bookkeeping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UpdateApplyOutcome {
    Installed,
    AlreadyCurrent,
    Failed,
}

/// Failure classification for an update apply, retained for `updater` bookkeeping.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UpdateFailureClass {
    None,
    CheckFailed,
    InstallerExit,
    InstallerLaunch,
}

/// Transport that produced an observation. Kept because `serve` maps it onto
/// the session transport type; no observation leaves the process any more.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    Cli,
    Daemon,
    McpStdio,
    McpHttp,
}

/// Reported by `cua-driver telemetry status` and `cua-driver doctor`.
#[derive(Clone, Debug, serde::Serialize)]
pub struct TelemetryStatus {
    pub enabled: bool,
    pub source: &'static str,
    pub installation_id_present: bool,
    pub installation_id: Option<String>,
    pub registration_recorded: bool,
    pub current_release_recorded: bool,
}

/// Always `false`: this build never collects telemetry.
#[allow(dead_code)]
pub fn is_enabled() -> bool {
    false
}

pub fn status() -> TelemetryStatus {
    TelemetryStatus {
        enabled: false,
        source: "removed",
        installation_id_present: false,
        installation_id: None,
        registration_recorded: false,
        current_release_recorded: false,
    }
}

/// Enabling is refused so `telemetry enable` cannot claim a success that this
/// build would not honour.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    if enabled {
        return Err(
            "telemetry has been removed from this build; there is nothing to enable".to_owned(),
        );
    }
    Ok(())
}

/// Nothing to erase in a fresh install, but a machine that previously ran the
/// upstream driver can still hold `~/.cua-driver/.telemetry_id` and its event
/// markers. `telemetry reset-id` is the advertised erasure path, so it erases
/// them for real instead of reporting success over a leftover file.
pub fn reset_id() -> Result<(), String> {
    let Some(root) = home_root() else {
        return Ok(());
    };
    for directory in [HOME_SUBDIRECTORY, LEGACY_HOME_SUBDIRECTORY] {
        let home = root.join(directory);
        for name in [
            TELEMETRY_ID_FILE_NAME,
            INSTALLATION_RECORDED_FILE_NAME,
            TELEMETRY_RETRY_AFTER_FILE_NAME,
            TELEMETRY_INSTALL_CHANNEL_FILE_NAME,
        ] {
            remove_file_if_exists(&home.join(name))?;
        }
        let releases = home.join(RELEASE_RECORDED_DIRECTORY);
        if releases.is_dir() {
            std::fs::remove_dir_all(&releases)
                .map_err(|error| format!("failed to remove {}: {error}", releases.display()))?;
        }
    }
    Ok(())
}

fn remove_file_if_exists(path: &std::path::Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove {}: {error}", path.display())),
    }
}

/// `$HOME` on Unix, `%USERPROFILE%` on Windows.
fn home_root() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}

/// `telemetry inspect` had one purpose — printing the exact payload upstream
/// would have sent. There is no payload to inspect.
pub fn inspect_event(_event_name: &str) -> Result<serde_json::Value, String> {
    Err("telemetry has been removed from this build; there is no event payload".to_owned())
}

/// Fixed event names upstream emitted. Only the daemon start event survives as
/// a label; nothing is reported for it.
pub mod event {
    pub const SERVE_START_LEGACY: &str = "cua_driver_serve";
}

pub fn capture_start(_event_name: &'static str, _transport: Transport) {}

pub fn register_stdio_observer() {}

pub(crate) fn capture_mcp_session_started(
    _metadata: cua_driver_core::protocol::InitializeMetadata,
    _transport: Transport,
) {
}

pub(crate) fn capture_tool_completed(
    _outcome: cua_driver_core::server::ToolCompletionObservation,
    _transport: Transport,
) {
}

pub(crate) fn capture_mcp_startup_completed(
    _path: &'static str,
    _daemon: &'static str,
    _success: bool,
    _elapsed: Duration,
) {
}

pub(crate) fn capture_permissions_gate_started(
    _missing_accessibility: bool,
    _missing_screen_recording: bool,
) {
}

pub(crate) fn capture_permissions_gate_dismissed(
    _missing_accessibility: bool,
    _missing_screen_recording: bool,
    _elapsed: Duration,
) {
}

pub(crate) fn capture_permissions_gate_completed(
    _missing_accessibility: bool,
    _missing_screen_recording: bool,
    _panel_shown: bool,
    _dismissed: bool,
    _resolution: &'static str,
    _elapsed: Duration,
) {
}

/// Kept verbatim: `main` uses it to label the permissions gate outcome it
/// prints to the operator, independent of any reporting.
pub(crate) const fn permissions_gate_resolution(
    gate_failed: bool,
    dismissed: bool,
) -> &'static str {
    if gate_failed {
        "timeout"
    } else if dismissed {
        "dismissed_then_granted"
    } else {
        "granted"
    }
}

pub fn capture_install() {}

pub(crate) fn run_lifecycle_worker_if_requested() -> bool {
    false
}

pub(crate) fn spawn_first_run_registration_worker() {}

pub(crate) fn capture_update_checked(
    _source: UpdateCheckSource,
    _outcome: UpdateCheckOutcome,
    _target_version: Option<&str>,
    _cache_hit: bool,
) {
}

pub(crate) fn capture_update_apply_started(_target_version: &str, _daemon_was_running: bool) {}

pub(crate) fn capture_update_apply_completed(
    _target_version: Option<&str>,
    _outcome: UpdateApplyOutcome,
    _failure_class: UpdateFailureClass,
    _daemon_was_running: bool,
    _elapsed: Duration,
) {
}

pub(crate) fn run_update_event_worker_if_requested() -> bool {
    false
}

/// Never true: no process is re-entered as a telemetry child.
pub(crate) fn is_wrapped_cli_child() -> bool {
    false
}

pub(crate) fn run_cli_completion_worker_if_requested() -> bool {
    false
}

/// Nothing is ever queued, so this must not wait. Upstream slept up to the
/// given timeout while draining its spool.
pub(crate) fn flush_pending(_timeout: Duration) {}
