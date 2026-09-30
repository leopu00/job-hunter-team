fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_voice_input();
    }
    tauri_build::build()
}

fn build_macos_voice_input() {
    use std::{env, path::PathBuf, process::Command};

    let source = PathBuf::from("native/macos/VoiceInput.macos-native.txt");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR missing"));
    let object = out.join("VoiceInput.o");
    let archive = out.join("libjht_voice_input.a");

    let compiled = Command::new("xcrun")
        .args([
            "clang",
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
