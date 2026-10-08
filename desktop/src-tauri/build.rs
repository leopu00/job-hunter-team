use std::{env, fs};

#[path = "src/release_channel_rules.rs"]
#[allow(dead_code)]
mod release_channel_rules;

fn main() {
    println!("cargo:rerun-if-env-changed=VITE_SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=VITE_SUPABASE_ANON_KEY");
    println!("cargo:rerun-if-changed=../.env.local");
    let supabase_url = build_value("VITE_SUPABASE_URL");
    let supabase_anon_key = build_value("VITE_SUPABASE_ANON_KEY");
    // These are the same public project coordinates embedded by Vite. Rust
    // also needs them to ask Supabase Auth to verify a stored access token;
    // service-role credentials must never be accepted here.
    println!("cargo:rustc-env=JHT_SUPABASE_URL={supabase_url}");
    println!("cargo:rustc-env=JHT_SUPABASE_ANON_KEY={supabase_anon_key}");

    emit_release_channel();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_voice_input();
    }
    tauri_build::build()
}

fn build_value(name: &str) -> String {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let env_file = fs::read_to_string("../.env.local").ok()?;
            env_file.lines().find_map(|line| {
                let (candidate, value) = line.trim().split_once('=')?;
                (candidate.trim() == name).then(|| {
                    value
                        .trim()
                        .trim_matches(|character| character == '\'' || character == '"')
                        .to_string()
                })
            })
        })
        .unwrap_or_default()
}

fn build_macos_voice_input() {
    use std::{env, path::PathBuf, process::Command};

    let source = PathBuf::from("native/macos/VoiceInput.macos-native.txt");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR missing"));
    let object = out.join("VoiceInput.o");
    let archive = out.join("libjht_voice_input.a");
    // clang defaults to the host architecture. A universal build runs this
    // script once per slice on the same host, so the object must follow the
    // Cargo target or the linker drops it from the other slice.
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("unsupported macOS target architecture for voice input: {other:?}"),
    };

    let compiled = Command::new("xcrun")
        .args([
            "clang",
            "-arch",
            arch,
            "-fobjc-arc",
            "-fmodules",
            "-fblocks",
            "-mmacosx-version-min=10.15",
            "-x",
            "objective-c",
            "-c",
        ])
        .arg(&source)
        .arg("-o")
        .arg(&object)
        .status()
        .expect("failed to run xcrun clang for native voice input");
    assert!(compiled.success(), "native voice input compilation failed");

    let archived = Command::new("xcrun")
        .args(["libtool", "-static", "-o"])
        .arg(&archive)
        .arg(&object)
        .status()
        .expect("failed to archive native voice input");
    assert!(archived.success(), "native voice input archive failed");

    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=jht_voice_input");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=Speech");
}

/// The release channel, fixed at build time (release_channel_rules.rs). A
/// test build without every value, or values without a test channel, does
/// not build at all.
fn emit_release_channel() {
    let names = [
        "JHT_CHANNEL",
        "JHT_SOURCE_SHA",
        "JHT_RUNTIME_IMAGE",
        "JHT_RUNTIME_IMAGE_DIGEST",
        "JHT_INSTALL_SHA256",
    ];
    for name in names {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let [channel, source_sha, runtime_image, image_digest, install_sha256] =
        names.map(|name| env::var(name).ok());
    let resolved = release_channel_rules::resolve(
        channel.as_deref(),
        source_sha.as_deref(),
        runtime_image.as_deref(),
        image_digest.as_deref(),
        install_sha256.as_deref(),
    )
    .unwrap_or_else(|error| panic!("release channel: {error}"));
    match resolved {
        None => {
            println!("cargo:rustc-env=JHT_BUILD_CHANNEL=production");
            println!("cargo:rustc-env=JHT_BUILD_SOURCE_SHA=");
            println!("cargo:rustc-env=JHT_BUILD_RUNTIME_IMAGE=");
            println!("cargo:rustc-env=JHT_BUILD_RUNTIME_IMAGE_DIGEST=");
            println!("cargo:rustc-env=JHT_BUILD_INSTALL_SHA256=");
        }
        Some(test) => {
            println!("cargo:rustc-env=JHT_BUILD_CHANNEL=test");
            println!("cargo:rustc-env=JHT_BUILD_SOURCE_SHA={}", test.source_sha);
            println!(
                "cargo:rustc-env=JHT_BUILD_RUNTIME_IMAGE={}",
                test.runtime_image
            );
            println!(
                "cargo:rustc-env=JHT_BUILD_RUNTIME_IMAGE_DIGEST={}",
                test.image_digest
            );
            println!(
                "cargo:rustc-env=JHT_BUILD_INSTALL_SHA256={}",
                test.install_sha256
            );
        }
    }
}
