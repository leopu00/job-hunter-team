use crate::onboarding::{attest_then, remote_install_input};
use std::cell::Cell;

const INSTALLER: &[u8] = b"synthetic installer\n";
const INSTALLER_SHA256: &str = "a495118dafdfb5b5c5e128b844ad994007b226116826ab1b129842105d957b30";
const DIFFERENT_SHA256: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const PAIRING_TOKEN: &str = "YWJjZGVmZ2hpamtsbW5vcA==";

#[test]
fn local_execution_stays_closed_for_missing_invalid_or_mismatched_digest() {
    for (expected_digest, expected_code) in [
        ("", "installer_digest_missing"),
        ("not-a-sha256", "installer_digest_invalid"),
        (DIFFERENT_SHA256, "installer_digest_mismatch"),
    ] {
        let executed = Cell::new(false);

        let error = attest_then(INSTALLER.to_vec(), expected_digest, |_| {
            executed.set(true);
            Ok(())
        })
        .expect_err("untrusted installer must be rejected");

        assert_eq!(error.code, expected_code);
        assert!(
            !executed.get(),
            "local shell execution must follow successful attestation"
        );
    }
}

#[test]
fn local_execution_receives_only_the_verified_installer() {
    let executions = Cell::new(0);

    attest_then(INSTALLER.to_vec(), INSTALLER_SHA256, |installer| {
        executions.set(executions.get() + 1);
        assert_eq!(installer.bytes(), INSTALLER);
        assert_eq!(installer.digest(), INSTALLER_SHA256);
        Ok(())
    })
    .expect("matching installer digest must be accepted");

    assert_eq!(executions.get(), 1);
}

#[test]
fn vps_execution_stays_closed_for_missing_invalid_or_mismatched_digest() {
    for (expected_digest, expected_code) in [
        ("", "installer_digest_missing"),
        ("not-a-sha256", "installer_digest_invalid"),
        (DIFFERENT_SHA256, "installer_digest_mismatch"),
    ] {
        let executed = Cell::new(false);

        let error = attest_then(INSTALLER.to_vec(), expected_digest, |installer| {
            executed.set(true);
            remote_install_input(installer, PAIRING_TOKEN).map(|_| ())
        })
        .expect_err("untrusted installer must be rejected");

        assert_eq!(error.code, expected_code);
        assert!(
            !executed.get(),
            "SSH execution and payload construction must follow successful attestation"
        );
    }
}

#[test]
fn vps_payload_carries_the_attested_bytes_and_digest_without_network() {
    let executions = Cell::new(0);

    let payload = attest_then(INSTALLER.to_vec(), INSTALLER_SHA256, |installer| {
        executions.set(executions.get() + 1);
        remote_install_input(installer, PAIRING_TOKEN)
    })
    .expect("matching installer digest must produce a remote payload");

    let expected_payload = [
        INSTALLER_SHA256.as_bytes(),
        b"\n",
        PAIRING_TOKEN.as_bytes(),
        b"\n",
        INSTALLER,
    ]
    .concat();
    assert_eq!(executions.get(), 1);
    assert_eq!(payload.as_slice(), expected_payload.as_slice());
}
