//! Local stub for `msvc_spectre_libs`.
//!
//! Why this exists: `cua-driver-core` depends on `regorus`, whose `std` feature
//! enables `msvc_spectre_libs/error`. Upstream's build script then panics on a
//! Windows host unless the "MSVC Spectre-mitigated libs" component is installed
//! with Visual Studio (`lib\spectre\x64` next to the MSVC toolset). That
//! component is an opt-in VS workload item; requiring it would make this vendored
//! build fail on a plain Build Tools installation.
//!
//! What upstream does: the crate only appends the Spectre lib directory to the
//! native link search path. It never enables `/Qspectre` itself — that comes
//! from the C/C++ project that builds the native code. Rust builds this
//! workspace with the default (non-Spectre) CRT, so those libraries are not
//! linked and the search path is unused. Dropping the build script therefore
//! removes a host requirement without changing what is linked.
//!
//! ZCode choice: replace the build script with nothing, via `[patch.crates-io]`
//! in the workspace `Cargo.toml`, so the checkout builds on any Windows host.
//! See `third-party/cua-driver/README.md` ("Windows build environment").
