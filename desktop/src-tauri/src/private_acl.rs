//! Owner-only access for JHT private files and directories on Windows: the
//! counterpart of 0600/0700 on Unix.
//!
//! Without this a private node is private only because it happens to inherit
//! the ACL of the user profile. Here the DACL is replaced by a protected one
//! (inheritance from the parent disabled) that grants full control to the
//! current user and to SYSTEM only, the same policy as
//! `scripts/windows-private-acl.ps1` minus Administrators. The result is read
//! back from the file system and any deviation is an error: callers stop
//! instead of writing private data into a node that is not private.

use std::{ffi::OsStr, os::windows::ffi::OsStrExt, path::Path, ptr};

use windows_sys::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE},
        Security::{
            AclSizeInformation,
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                GetNamedSecurityInfoW, SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
            },
            GetAce, GetAclInformation, GetSecurityDescriptorControl, GetSecurityDescriptorDacl,
            GetTokenInformation, TokenUser, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL,
            ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
            PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

const LOCAL_SYSTEM_SID: &str = "S-1-5-18";
// winnt.h ACE types: an allow ACE is checked against the owner-only policy, a
// deny ACE can only take access away. Every other type (object, callback,
// audit) is unexpected in a DACL written here and fails the check.
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AclReport {
    pub(crate) inheritance_disabled: bool,
    pub(crate) allowed_sids: Vec<String>,
}

pub(crate) fn protect_dir(path: &Path) -> Result<(), &'static str> {
    // OICI: files and directories created later inside inherit the same two
    // entries, and SetNamedSecurityInfoW re-propagates them to what is
    // already there, dropping entries those children inherited before.
    protect(path, "OICI")
}

pub(crate) fn protect_file(path: &Path) -> Result<(), &'static str> {
    protect(path, "")
}

fn protect(path: &Path, inheritance: &str) -> Result<(), &'static str> {
    let user = current_user_sid()?;
    let sddl = format!("D:P(A;{inheritance};FA;;;{user})(A;{inheritance};FA;;;SY)");
    let sddl = wide(OsStr::new(&sddl))?;
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: `sddl` is NUL-terminated UTF-16; the descriptor is allocated by
    // the call and released with LocalFree below.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err("permissions_failed");
    }
    let result = (|| {
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl: *mut ACL = ptr::null_mut();
        // SAFETY: `descriptor` is the valid descriptor returned above; `dacl`
        // points into it and is used before it is freed.
        if unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) }
            == 0
            || present == 0
            || dacl.is_null()
        {
            return Err("permissions_failed");
        }
        let target = wide(path.as_os_str())?;
        // SAFETY: `target` is a NUL-terminated UTF-16 path and `dacl` a valid
        // ACL; owner, group and SACL are left untouched.
        let status = unsafe {
            SetNamedSecurityInfoW(
                target.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                ptr::null_mut(),
                ptr::null_mut(),
                dacl,
                ptr::null(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err("permissions_failed");
        }
        Ok(())
    })();
    // SAFETY: allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
    unsafe { LocalFree(descriptor) };
    result?;

    // A successful call is not the effect: read the ACL that is really there.
    if is_owner_only(&read_acl(path)?, &user) {
        Ok(())
    } else {
        Err("permissions_failed")
    }
}

/// Inheritance is disabled, the current user is allowed, and nobody else is
/// allowed except SYSTEM.
pub(crate) fn is_owner_only(report: &AclReport, user_sid: &str) -> bool {
    report.inheritance_disabled
        && report.allowed_sids.iter().any(|sid| sid == user_sid)
        && report
            .allowed_sids
            .iter()
            .all(|sid| sid == user_sid || sid == LOCAL_SYSTEM_SID)
}

pub(crate) fn read_acl(path: &Path) -> Result<AclReport, &'static str> {
    let target = wide(path.as_os_str())?;
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: `target` is NUL-terminated UTF-16; `dacl` points into the
    // descriptor allocated by the call, released with LocalFree below.
    let status = unsafe {
        GetNamedSecurityInfoW(
            target.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err("permissions_unreadable");
    }
    let report = (|| {
        let mut control = 0u16;
        let mut revision = 0u32;
        // SAFETY: `descriptor` is valid until the LocalFree below.
        if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0 {
            return Err("permissions_unreadable");
        }
        // A NULL DACL grants everyone full access: never owner-only.
        if dacl.is_null() {
            return Err("permissions_unreadable");
        }
        let mut size = ACL_SIZE_INFORMATION::default();
        // SAFETY: `dacl` is valid and `size` has the size passed in.
        if unsafe {
            GetAclInformation(
                dacl,
                (&mut size as *mut ACL_SIZE_INFORMATION).cast(),
                std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
                AclSizeInformation,
            )
        } == 0
        {
            return Err("permissions_unreadable");
        }
        let mut allowed_sids = Vec::new();
        for index in 0..size.AceCount {
            let mut ace: *mut core::ffi::c_void = ptr::null_mut();
            // SAFETY: `index` is below the ACE count of a valid ACL.
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 || ace.is_null() {
                return Err("permissions_unreadable");
            }
            // SAFETY: every ACE starts with an ACE_HEADER.
            let header = unsafe { &*(ace as *const ACE_HEADER) };
            match header.AceType {
                ACCESS_ALLOWED_ACE_TYPE => {
                    let allowed = ace as *const ACCESS_ALLOWED_ACE;
                    // SAFETY: an ACCESS_ALLOWED_ACE stores its SID in place,
                    // starting at SidStart.
                    let sid = unsafe { ptr::addr_of!((*allowed).SidStart) } as PSID;
                    allowed_sids.push(sid_string(sid)?);
                }
                ACCESS_DENIED_ACE_TYPE => {}
                _ => return Err("permissions_unexpected"),
            }
        }
        Ok(AclReport {
            inheritance_disabled: control & SE_DACL_PROTECTED != 0,
            allowed_sids,
        })
    })();
    // SAFETY: allocated by GetNamedSecurityInfoW.
    unsafe { LocalFree(descriptor) };
    report
}

pub(crate) fn current_user_sid() -> Result<String, &'static str> {
    let mut token: HANDLE = ptr::null_mut();
    // SAFETY: the pseudo-handle of the current process needs no closing; the
    // token handle is closed below.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err("permissions_failed");
    }
    let result = (|| {
        let mut length = 0u32;
        // SAFETY: a size query with an empty buffer; it fails by design and
        // reports the required length.
        unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut length) };
        if length == 0 {
            return Err("permissions_failed");
        }
        // u64 storage keeps TOKEN_USER and the SID that follows it aligned.
        let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
        // SAFETY: `buffer` holds at least `length` bytes.
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                length,
                &mut length,
            )
        } == 0
        {
            return Err("permissions_failed");
        }
        // SAFETY: the call filled the buffer with a TOKEN_USER whose SID
        // points inside the same buffer, alive for this scope.
        let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
        sid_string(user.User.Sid)
    })();
    // SAFETY: `token` was opened above.
    unsafe { CloseHandle(token) };
    result
}

fn sid_string(sid: PSID) -> Result<String, &'static str> {
    let mut text: PWSTR = ptr::null_mut();
    // SAFETY: `sid` is a valid SID; the string is allocated by the call and
    // released with LocalFree below.
    if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 || text.is_null() {
        return Err("permissions_unreadable");
    }
    // SAFETY: the returned string is NUL-terminated.
    let length = (0..)
        .take_while(|&index| unsafe { *text.add(index) } != 0)
        .count();
    // SAFETY: `length` UTF-16 units precede the terminator.
    let value = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) });
    // SAFETY: allocated by ConvertSidToStringSidW.
    unsafe { LocalFree(text.cast()) };
    value.map_err(|_| "permissions_unreadable")
}

fn wide(value: &OsStr) -> Result<Vec<u16>, &'static str> {
    let mut units: Vec<u16> = value.encode_wide().collect();
    // An interior NUL would silently shorten the path the API sees.
    if units.contains(&0) {
        return Err("permissions_failed");
    }
    units.push(0);
    Ok(units)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const EVERYONE: &str = "S-1-1-0";
    const USERS: &str = "S-1-5-32-545";
    const AUTHENTICATED_USERS: &str = "S-1-5-11";

    fn scratch(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "jht-private-acl-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        root
    }

    /// An open parent ACL that its children inherit: the situation a private
    /// directory must not be left in.
    fn open_to_everyone_and_users(path: &Path) {
        let user = current_user_sid().unwrap();
        let sddl =
            format!("D:(A;OICI;FA;;;{user})(A;OICI;FA;;;WD)(A;OICI;FA;;;BU)(A;OICI;FA;;;AU)");
        let sddl = wide(OsStr::new(&sddl)).unwrap();
        let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
        let mut present = 0;
        let mut defaulted = 0;
        let mut dacl: *mut ACL = ptr::null_mut();
        let target = wide(path.as_os_str()).unwrap();
        unsafe {
            assert_ne!(
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    ptr::null_mut(),
                ),
                0
            );
            assert_ne!(
                GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted),
                0
            );
            assert_eq!(
                SetNamedSecurityInfoW(
                    target.as_ptr(),
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION,
                    ptr::null_mut(),
                    ptr::null_mut(),
                    dacl,
                    ptr::null(),
                ),
                ERROR_SUCCESS
            );
            LocalFree(descriptor);
        }
    }

    fn assert_owner_only(path: &Path) {
        let user = current_user_sid().unwrap();
        let report = read_acl(path).unwrap();
        assert!(report.inheritance_disabled, "{path:?}: {report:?}");
        assert!(report.allowed_sids.contains(&user), "{path:?}: {report:?}");
        for broad in [EVERYONE, USERS, AUTHENTICATED_USERS] {
            assert!(
                !report.allowed_sids.iter().any(|sid| sid == broad),
                "{path:?}: {report:?}"
            );
        }
        assert!(is_owner_only(&report, &user), "{path:?}: {report:?}");
    }

    #[test]
    fn private_dir_gets_a_protected_owner_only_acl_also_for_existing_children() {
        let root = scratch("dir");
        open_to_everyone_and_users(&root);
        let private = root.join("profile");
        fs::create_dir(&private).unwrap();
        let existing = private.join("candidate_profile.yml");
        fs::write(&existing, b"name: fixture\n").unwrap();
        // Precondition: the directory and its file really inherit the open ACL.
        let before = read_acl(&private).unwrap();
        assert!(!before.inheritance_disabled);
        assert!(before.allowed_sids.iter().any(|sid| sid == EVERYONE));
        assert!(read_acl(&existing)
            .unwrap()
            .allowed_sids
            .iter()
            .any(|sid| sid == EVERYONE));

        crate::runtime_host::set_private_dir_permissions(&private).unwrap();

        assert_owner_only(&private);
        // Children keep inheriting, but only from the protected directory.
        let user = current_user_sid().unwrap();
        let created_after = private.join("receipt.json");
        fs::write(&created_after, b"{}").unwrap();
        for node in [&existing, &created_after] {
            let report = read_acl(node).unwrap();
            assert!(report.allowed_sids.contains(&user), "{node:?}: {report:?}");
            assert!(
                report
                    .allowed_sids
                    .iter()
                    .all(|sid| sid == &user || sid == LOCAL_SYSTEM_SID),
                "{node:?}: {report:?}"
            );
        }
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn private_file_gets_a_protected_owner_only_acl() {
        let root = scratch("file");
        open_to_everyone_and_users(&root);
        let file = root.join("known_hosts");
        fs::write(&file, b"fixture\n").unwrap();
        assert!(read_acl(&file)
            .unwrap()
            .allowed_sids
            .iter()
            .any(|sid| sid == EVERYONE));

        crate::runtime_host::set_private_permissions(&file).unwrap();

        assert_owner_only(&file);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_failed_acl_stops_the_operation() {
        let root = scratch("fail");
        let missing = root.join("missing");
        assert_eq!(
            crate::runtime_host::set_private_dir_permissions(&missing),
            Err("permissions_failed")
        );
        assert_eq!(
            crate::runtime_host::set_private_permissions(&missing),
            Err("permissions_failed")
        );
        assert!(read_acl(&missing).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn owner_only_policy_rejects_broad_or_inherited_access() {
        let user = "S-1-5-21-1-2-3-1001".to_string();
        let ok = AclReport {
            inheritance_disabled: true,
            allowed_sids: vec![user.clone(), LOCAL_SYSTEM_SID.into()],
        };
        assert!(is_owner_only(&ok, &user));
        assert!(!is_owner_only(
            &AclReport {
                inheritance_disabled: false,
                ..ok.clone()
            },
            &user
        ));
        assert!(!is_owner_only(
            &AclReport {
                allowed_sids: vec![LOCAL_SYSTEM_SID.into()],
                ..ok.clone()
            },
            &user
        ));
        for broad in [EVERYONE, USERS, AUTHENTICATED_USERS, "S-1-5-32-544"] {
            let mut open = ok.clone();
            open.allowed_sids.push(broad.into());
            assert!(!is_owner_only(&open, &user), "{broad}");
        }
    }
}
