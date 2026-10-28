//! What a file the person attaches in the chat IS, decided by its content and never by the name it was
//! given, and what is never attached: programs, scripts and archives.
//!
//! Pure: bytes in, a decision out. Nothing is read from disk here, nothing is unpacked: an office file
//! is told by the directory of its zip, which is never trusted for sizes beyond the sum it declares.
//!
//! The decision carries the extension the copy will have, always one of a closed list of `'static`
//! strings: the person's own extension is never copied to the disk (it could be anything), except when
//! it is one of the text names below.
//!
//! The agents read these files and the person opens them with the system's program: an executable, a
//! script, an archive, a document that carries a macro, never gets in. The list of extensions below is
//! a rule of the product, not a defence (a program can be renamed): the defence is the content.

/// Which sort of file it is. The word is what the message to the agent and the person's screen use.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Pdf,
    Word,
    Sheet,
    Slides,
    Image,
    Text,
    Other,
}

impl Kind {
    /// The closed word of the kind in the bracket the agent reads and in the page's table.
    pub(crate) fn word(self) -> &'static str {
        match self {
            Kind::Pdf => "pdf",
            Kind::Word => "word",
            Kind::Sheet => "sheet",
            Kind::Slides => "slides",
            Kind::Image => "image",
            Kind::Text => "text",
            Kind::Other => "other",
        }
    }

    /// The kinds the person may open with a click: documents the system shows without running anything of
    /// their own. `other` is not one of them, and neither is a spreadsheet of text (`csv`, `tsv`: a cell that
    /// starts with `=` is a formula for the program that opens it).
    pub(crate) fn opens_with_a_click(self, extension: &str) -> bool {
        match self {
            Kind::Other => false,
            Kind::Text => !matches!(extension, "csv" | "tsv"),
            _ => true,
        }
    }
}

/// The decision: the kind and the extension the copy gets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Decided {
    pub(crate) kind: Kind,
    pub(crate) extension: &'static str,
}

fn decided(kind: Kind, extension: &'static str) -> Result<Decided, &'static str> {
    Ok(Decided { kind, extension })
}

/// The names of text the person's own extension may keep; any other name of text becomes `txt`.
const TEXT_EXTENSIONS: [&str; 5] = ["txt", "md", "csv", "tsv", "json"];

/// Extensions of programs, scripts, installers, disk images, profiles and shortcuts. Refused whatever the
/// content (a script is text). Not a defence on its own: see the module's note.
const NOT_ATTACHED_EXTENSIONS: &[&str] = &[
    "exe", "dll", "msi", "msix", "app", "command", "sh", "bash", "zsh", "csh", "ksh", "fish", "bat", "cmd", "ps1", "psm1",
    "vbs", "vbe", "wsf", "wsh", "js", "jse", "mjs", "cjs", "py", "pyc", "pyw", "rb", "pl", "php", "lua", "scr", "lnk",
    "url", "desktop", "jar", "apk", "deb", "rpm", "dmg", "pkg", "iso", "img", "mobileconfig", "webloc", "inetloc",
    "fileloc", "terminal", "scpt", "scptd", "workflow", "action", "hta", "reg", "jnlp", "com", "appimage", "run", "so",
    "dylib", "kext", "docm", "xlsm", "pptm", "xlam",
];

/// Whole-archive formats named by their extension even when the content cannot be told (a corrupt or
/// partial one): refused as archives.
const ARCHIVE_EXTENSIONS: &[&str] = &[
    "zip", "tar", "gz", "tgz", "bz2", "tbz", "xz", "txz", "7z", "rar", "zst", "cab", "cpio", "ar", "lz",
];

/// The most a zip may declare once unpacked (the sum from its directory); more is refused as an archive.
const MAX_DECLARED_UNPACKED: u64 = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 20_000;

fn le16(bytes: &[u8], at: usize) -> Option<usize> {
    let part = bytes.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes([part[0], part[1]]) as usize)
}

fn le32(bytes: &[u8], at: usize) -> Option<usize> {
    let part = bytes.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes([part[0], part[1], part[2], part[3]]) as usize)
}

/// A program by its first bytes: Windows (`MZ`), ELF, Mach-O (thin, either byte order, and universal, whose
/// magic Java classes share), and a script with an interpreter line.
fn is_program(bytes: &[u8]) -> bool {
    // «MZ» are two letters a text may start with (a name, an acronym): a Windows program is not valid text
    (bytes.starts_with(b"MZ") && !is_text(bytes))
        || bytes.starts_with(b"\x7fELF")
        || bytes.starts_with(b"#!")
        || [
            b"\xfe\xed\xfa\xce".as_slice(),
            b"\xfe\xed\xfa\xcf",
            b"\xce\xfa\xed\xfe",
            b"\xcf\xfa\xed\xfe",
            b"\xca\xfe\xba\xbe",
            b"\xbe\xba\xfe\xca",
        ]
        .iter()
        .any(|magic| bytes.starts_with(magic))
}

/// An archive or a disk image by its bytes: gzip, bzip2, xz, 7z, rar, zstd, xar (pkg), cpio, ar (deb), cab, lz4,
/// lzip, tar (`ustar` at 257), iso (`CD001` at 32769), a disk image of macOS (`koly` in the last 512 bytes).
fn is_archive(bytes: &[u8]) -> bool {
    let starts = |magic: &[u8]| bytes.starts_with(magic);
    starts(b"\x1f\x8b")
        || starts(b"BZh")
        || starts(b"\xfd7zXZ\x00")
        || starts(b"7z\xbc\xaf\x27\x1c")
        || starts(b"Rar!\x1a\x07")
        || starts(b"\x28\xb5\x2f\xfd")
        || starts(b"xar!")
        || starts(b"070701")
        || starts(b"070702")
        || starts(b"070707")
        || starts(b"\xc7\x71")
        || starts(b"\x71\xc7")
        || starts(b"!<arch>\n")
        || starts(b"MSCF")
        || starts(b"\x04\x22\x4d\x18")
        || starts(b"LZIP")
        || bytes.get(257..262) == Some(b"ustar".as_slice())
        || bytes.get(32769..32774) == Some(b"CD001".as_slice())
        || bytes.len() >= 512 && bytes[bytes.len() - 512..].starts_with(b"koly")
}

/// A zip by its signature (a file, an empty one, a spanned one).
fn is_zip(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08")
}

/// What an office file is by what is inside, read from the zip's own directory (nothing is unpacked).
enum Office {
    Kind(Decided),
    /// It is a program inside a document (a macro, a Basic library): never attached.
    Program,
    /// It is a zip, but not an office file, or one built to be read wrongly: an archive.
    Archive,
}

fn office(bytes: &[u8]) -> Office {
    if bytes.len() < 22 || !bytes.starts_with(b"PK\x03\x04") {
        return Office::Archive;
    }
    let first = bytes.len().saturating_sub(22 + 65535);
    let Some(end) = (first..=bytes.len() - 22).rev().find(|&i| bytes[i..].starts_with(b"PK\x05\x06")) else {
        return Office::Archive;
    };
    // zip64: a document of at most 5 MB does not need it; a directory that says «look elsewhere» is not read
    if bytes.get(end.wrapping_sub(20)..end.wrapping_sub(16)) == Some(b"PK\x06\x07".as_slice()) && end >= 20 {
        return Office::Archive;
    }
    let (Some(entries), Some(mut at)) = (le16(bytes, end + 10), le32(bytes, end + 16)) else {
        return Office::Archive;
    };
    if entries == 0xFFFF || entries > MAX_ZIP_ENTRIES {
        return Office::Archive;
    }
    let mut names: Vec<&[u8]> = Vec::new();
    let mut unpacked: u64 = 0;
    for _ in 0..entries {
        if !bytes.get(at..).is_some_and(|rest| rest.starts_with(b"PK\x01\x02")) {
            return Office::Archive;
        }
        let (Some(size), Some(name_len), Some(extra), Some(comment)) =
            (le32(bytes, at + 24), le16(bytes, at + 28), le16(bytes, at + 30), le16(bytes, at + 32))
        else {
            return Office::Archive;
        };
        if size == 0xFFFF_FFFF {
            return Office::Archive;
        }
        unpacked += size as u64;
        if unpacked > MAX_DECLARED_UNPACKED {
            return Office::Archive;
        }
        let Some(name) = bytes.get(at + 46..at + 46 + name_len) else {
            return Office::Archive;
        };
        // a name that leaves the archive or is absolute is not a document's
        if name.starts_with(b"/") || name.windows(3).any(|w| w == b"../") || name.starts_with(b"..") {
            return Office::Archive;
        }
        names.push(name);
        at = at + 46 + name_len + extra + comment;
    }
    let has = |name: &[u8]| names.iter().any(|candidate| *candidate == name);
    let lower_ends = |suffix: &[u8]| {
        names.iter().any(|candidate| {
            candidate.len() >= suffix.len() && candidate[candidate.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
        })
    };
    let starts = |prefix: &[u8]| names.iter().any(|candidate| candidate.starts_with(prefix));
    // a macro of Office, a Basic or script library of OpenDocument: a program inside the document
    if lower_ends(b"vbaproject.bin") || lower_ends(b"vbadata.xml") || starts(b"Scripts/") || starts(b"Basic/") || starts(b"Dialogs/") {
        return Office::Program;
    }
    if has(b"[Content_Types].xml") {
        if has(b"word/document.xml") {
            return Office::Kind(Decided { kind: Kind::Word, extension: "docx" });
        }
        if has(b"xl/workbook.xml") {
            return Office::Kind(Decided { kind: Kind::Sheet, extension: "xlsx" });
        }
        if has(b"ppt/presentation.xml") {
            return Office::Kind(Decided { kind: Kind::Slides, extension: "pptx" });
        }
    }
    if has(b"content.xml") {
        if let Some(mime) = odf_mimetype(bytes) {
            return match mime {
                b"application/vnd.oasis.opendocument.text" => Office::Kind(Decided { kind: Kind::Word, extension: "odt" }),
                b"application/vnd.oasis.opendocument.spreadsheet" => Office::Kind(Decided { kind: Kind::Sheet, extension: "ods" }),
                b"application/vnd.oasis.opendocument.presentation" => Office::Kind(Decided { kind: Kind::Slides, extension: "odp" }),
                _ => Office::Archive,
            };
        }
    }
    Office::Archive
}

/// An OpenDocument file keeps its `mimetype` as the archive's first entry, stored, and says what it is.
fn odf_mimetype(bytes: &[u8]) -> Option<&[u8]> {
    let (method, size, name_len, extra) = (le16(bytes, 8)?, le32(bytes, 18)?, le16(bytes, 26)?, le16(bytes, 28)?);
    if name_len != 8 || method != 0 || bytes.get(30..38) != Some(b"mimetype".as_slice()) || size > 100 {
        return None;
    }
    bytes.get(30 + 8 + extra..30 + 8 + extra + size)
}

fn is_text(bytes: &[u8]) -> bool {
    !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

/// What the file is and the extension its copy gets. Errors, closed codes: `attachment_empty` (no bytes),
/// `attachment_executable` (a program, a script, a document with a macro), `attachment_archive` (an archive,
/// a disk image, a zip that is not an office file).
pub(crate) fn classify(extension: &str, bytes: &[u8]) -> Result<Decided, &'static str> {
    if bytes.is_empty() {
        return Err("attachment_empty");
    }
    let extension = extension.to_ascii_lowercase();
    if NOT_ATTACHED_EXTENSIONS.contains(&extension.as_str()) || is_program(bytes) {
        return Err("attachment_executable");
    }
    if ARCHIVE_EXTENSIONS.contains(&extension.as_str()) {
        return Err("attachment_archive");
    }
    if is_zip(bytes) {
        return match office(bytes) {
            Office::Kind(found) => Ok(found),
            Office::Program => Err("attachment_executable"),
            Office::Archive => Err("attachment_archive"),
        };
    }
    if is_archive(bytes) {
        return Err("attachment_archive");
    }
    if bytes.starts_with(b"%PDF-") {
        return decided(Kind::Pdf, "pdf");
    }
    if bytes.starts_with(b"{\\rtf") {
        return decided(Kind::Word, "rtf");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return decided(Kind::Image, "png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return decided(Kind::Image, "jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return decided(Kind::Image, "gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return decided(Kind::Image, "webp");
    }
    if is_text(bytes) {
        let kept = TEXT_EXTENSIONS.iter().find(|name| **name == extension).copied().unwrap_or("txt");
        return decided(Kind::Text, kept);
    }
    decided(Kind::Other, "bin")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A zip with the given entries, stored: the local headers, the central directory and the end record, enough for
    /// what the reader looks at. `declared` makes every entry say it is that big once unpacked.
    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        zip_declaring(entries, None)
    }

    fn zip_declaring(entries: &[(&str, &[u8])], declared: Option<u32>) -> Vec<u8> {
        let mut out = Vec::new();
        let mut directory = Vec::new();
        for (name, data) in entries {
            let offset = out.len() as u32;
            let unpacked = declared.unwrap_or(data.len() as u32);
            let mut local = [0u8; 30];
            local[0..4].copy_from_slice(b"PK\x03\x04");
            local[4..6].copy_from_slice(&20u16.to_le_bytes());
            local[18..22].copy_from_slice(&(data.len() as u32).to_le_bytes());
            local[22..26].copy_from_slice(&unpacked.to_le_bytes());
            local[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&local);
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(data);
            let mut entry = [0u8; 46];
            entry[0..4].copy_from_slice(b"PK\x01\x02");
            entry[4..6].copy_from_slice(&20u16.to_le_bytes());
            entry[6..8].copy_from_slice(&20u16.to_le_bytes());
            entry[20..24].copy_from_slice(&(data.len() as u32).to_le_bytes());
            entry[24..28].copy_from_slice(&unpacked.to_le_bytes());
            entry[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
            entry[42..46].copy_from_slice(&offset.to_le_bytes());
            directory.extend_from_slice(&entry);
            directory.extend_from_slice(name.as_bytes());
        }
        let start = out.len() as u32;
        out.extend_from_slice(&directory);
        let mut end = [0u8; 22];
        end[0..4].copy_from_slice(b"PK\x05\x06");
        end[8..10].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        end[10..12].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        end[12..16].copy_from_slice(&(directory.len() as u32).to_le_bytes());
        end[16..20].copy_from_slice(&start.to_le_bytes());
        out.extend_from_slice(&end);
        out
    }

    fn docx() -> Vec<u8> {
        zip_of(&[("[Content_Types].xml", b"<x/>"), ("word/document.xml", b"<x/>")])
    }

    fn odf(mime: &str) -> Vec<u8> {
        zip_of(&[("mimetype", mime.as_bytes()), ("content.xml", b"<x/>")])
    }

    fn kind(extension: &str, bytes: &[u8]) -> (Kind, &'static str) {
        let found = classify(extension, bytes).expect("a file that is attached");
        (found.kind, found.extension)
    }

    #[test]
    fn each_sort_is_told_by_its_content_and_gets_an_extension_of_ours() {
        assert_eq!(kind("x", b"%PDF-1.7\nbody"), (Kind::Pdf, "pdf"));
        assert_eq!(kind("x", b"{\\rtf1\\ansi hello}"), (Kind::Word, "rtf"));
        assert_eq!(kind("x", &docx()), (Kind::Word, "docx"));
        assert_eq!(kind("x", &odf("application/vnd.oasis.opendocument.text")), (Kind::Word, "odt"));
        assert_eq!(
            kind("x", &zip_of(&[("[Content_Types].xml", b"<x/>"), ("xl/workbook.xml", b"<x/>")])),
            (Kind::Sheet, "xlsx")
        );
        assert_eq!(kind("x", &odf("application/vnd.oasis.opendocument.spreadsheet")), (Kind::Sheet, "ods"));
        assert_eq!(
            kind("x", &zip_of(&[("[Content_Types].xml", b"<x/>"), ("ppt/presentation.xml", b"<x/>")])),
            (Kind::Slides, "pptx")
        );
        assert_eq!(kind("x", &odf("application/vnd.oasis.opendocument.presentation")), (Kind::Slides, "odp"));
        assert_eq!(kind("x", b"\x89PNG\r\n\x1a\nrest"), (Kind::Image, "png"));
        assert_eq!(kind("x", b"\xff\xd8\xff\xe0rest"), (Kind::Image, "jpg"));
        assert_eq!(kind("x", b"GIF89a rest"), (Kind::Image, "gif"));
        assert_eq!(kind("x", b"RIFF\x10\0\0\0WEBPVP8 "), (Kind::Image, "webp"));
        assert_eq!(kind("x", "una riga, è testo".as_bytes()), (Kind::Text, "txt"));
        assert_eq!(kind("x", &[0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]), (Kind::Other, "bin"));
    }

    #[test]
    fn the_name_the_person_gave_does_not_decide_and_is_not_copied_to_the_disk() {
        // a PDF named like a picture, a picture named like a note
        assert_eq!(kind("png", b"%PDF-1.4 x"), (Kind::Pdf, "pdf"));
        assert_eq!(kind("txt", b"\x89PNG\r\n\x1a\nrest"), (Kind::Image, "png"));
        // text keeps its name only among a closed few; any other becomes txt
        for (name, expected) in [("csv", "csv"), ("TSV", "tsv"), ("json", "json"), ("md", "md"), ("txt", "txt"), ("html", "txt"), ("svg", "txt"), ("xml", "txt"), ("weird", "txt"), ("", "txt")] {
            assert_eq!(kind(name, b"a,b\n1,2\n"), (Kind::Text, expected), "{name}");
        }
        // anything else is .bin, never the person's own extension
        for name in ["dat", "xyz", "pages", "numbers", "key", "sketch", "psd"] {
            assert_eq!(kind(name, &[1, 2, 3, 0, 4]), (Kind::Other, "bin"), "{name}");
        }
    }

    #[test]
    fn a_text_that_starts_with_two_letters_that_are_also_a_program_is_a_text() {
        assert_eq!(kind("txt", "MZ Consulting, Milano: esperienza di sette anni".as_bytes()), (Kind::Text, "txt"));
        assert_eq!(classify("txt", b"MZ\x90\0\x03\0\0\0").unwrap_err(), "attachment_executable");
    }

    #[test]
    fn nothing_is_not_attached() {
        assert_eq!(classify("txt", b"").unwrap_err(), "attachment_empty");
    }

    #[test]
    fn a_program_is_refused_by_its_first_bytes_whatever_it_is_called() {
        let programs: [&[u8]; 9] = [
            b"MZ\x90\0\x03\0\0\0",
            b"\x7fELF\x02\x01\x01",
            b"\xfe\xed\xfa\xce\0\0",
            b"\xfe\xed\xfa\xcf\0\0",
            b"\xce\xfa\xed\xfe\0\0",
            b"\xcf\xfa\xed\xfe\0\0",
            b"\xca\xfe\xba\xbe\0\0\0\x02",
            b"\xbe\xba\xfe\xca\0\0",
            b"#!/bin/sh\necho hi\n",
        ];
        for bytes in programs {
            for name in ["pdf", "txt", "docx", "png", ""] {
                assert_eq!(classify(name, bytes).unwrap_err(), "attachment_executable", "{name} {:?}", &bytes[..4]);
            }
        }
    }

    #[test]
    fn a_script_or_a_program_is_refused_by_its_name_even_when_it_is_only_text() {
        for name in [
            "sh", "bash", "zsh", "bat", "cmd", "ps1", "vbs", "js", "mjs", "py", "rb", "pl", "php", "command", "scr", "lnk",
            "url", "desktop", "jar", "apk", "deb", "rpm", "dmg", "pkg", "iso", "msi", "exe", "dll", "app", "mobileconfig",
            "webloc", "inetloc", "fileloc", "terminal", "scpt", "workflow", "action", "hta", "reg", "jnlp", "com",
            "appimage", "run", "docm", "xlsm", "pptm", "SH", "Py",
        ] {
            assert_eq!(classify(name, b"echo hello\n").unwrap_err(), "attachment_executable", "{name}");
        }
    }

    #[test]
    fn an_archive_is_refused_by_its_bytes_and_by_its_name() {
        let archives: [(&str, Vec<u8>); 14] = [
            ("gzip", b"\x1f\x8b\x08\0".to_vec()),
            ("bzip2", b"BZh91AY".to_vec()),
            ("xz", b"\xfd7zXZ\0\0".to_vec()),
            ("7z", b"7z\xbc\xaf\x27\x1c\0".to_vec()),
            ("rar", b"Rar!\x1a\x07\0".to_vec()),
            ("zstd", b"\x28\xb5\x2f\xfd\0".to_vec()),
            ("xar", b"xar!\0\x1c".to_vec()),
            ("cpio", b"070701000000".to_vec()),
            ("ar", b"!<arch>\ndebian".to_vec()),
            ("cab", b"MSCF\0\0".to_vec()),
            ("lz4", b"\x04\x22\x4d\x18\0".to_vec()),
            ("tar", {
                let mut tar = vec![0u8; 512];
                tar[257..262].copy_from_slice(b"ustar");
                tar
            }),
            ("iso", {
                let mut iso = vec![0u8; 34_000];
                iso[32769..32774].copy_from_slice(b"CD001");
                iso
            }),
            ("dmg", {
                let mut dmg = vec![7u8; 4_000];
                let at = dmg.len() - 512;
                dmg[at..at + 4].copy_from_slice(b"koly");
                dmg
            }),
        ];
        for (what, bytes) in &archives {
            assert_eq!(classify("txt", bytes).unwrap_err(), "attachment_archive", "{what}");
        }
        // a zip that is not an office file, an empty one, a spanned one
        assert_eq!(classify("zip", &zip_of(&[("a.txt", b"x"), ("b.txt", b"y")])).unwrap_err(), "attachment_archive");
        assert_eq!(classify("pdf", &zip_of(&[("a.txt", b"x")])).unwrap_err(), "attachment_archive");
        assert_eq!(classify("zip", b"PK\x05\x06\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0").unwrap_err(), "attachment_archive");
        // by name, even when the bytes cannot be told
        for name in ["zip", "tar", "gz", "tgz", "7z", "rar", "xz", "bz2", "zst", "cab", "cpio", "ZIP"] {
            assert_eq!(classify(name, b"not really an archive").unwrap_err(), "attachment_archive", "{name}");
        }
    }

    #[test]
    fn a_document_with_a_macro_or_a_library_of_scripts_is_a_program() {
        let macro_docx = zip_of(&[
            ("[Content_Types].xml", b"<x/>"),
            ("word/document.xml", b"<x/>"),
            ("word/vbaProject.bin", b"\xd0\xcf\x11"),
        ]);
        assert_eq!(classify("docx", &macro_docx).unwrap_err(), "attachment_executable");
        let upper = zip_of(&[("[Content_Types].xml", b"<x/>"), ("xl/workbook.xml", b"<x/>"), ("xl/VBAPROJECT.BIN", b"x")]);
        assert_eq!(classify("xlsx", &upper).unwrap_err(), "attachment_executable");
        let basic = zip_of(&[
            ("mimetype", b"application/vnd.oasis.opendocument.text"),
            ("content.xml", b"<x/>"),
            ("Basic/Standard/Module1.xml", b"x"),
        ]);
        assert_eq!(classify("odt", &basic).unwrap_err(), "attachment_executable");
        let scripts = zip_of(&[
            ("mimetype", b"application/vnd.oasis.opendocument.spreadsheet"),
            ("content.xml", b"<x/>"),
            ("Scripts/python/m.py", b"x"),
        ]);
        assert_eq!(classify("ods", &scripts).unwrap_err(), "attachment_executable");
    }

    #[test]
    fn an_office_file_needs_its_exact_parts_not_just_a_content_types_file() {
        // a content-types file and nothing of Word: not a document
        assert_eq!(classify("docx", &zip_of(&[("[Content_Types].xml", b"<x/>"), ("readme.txt", b"x")])).unwrap_err(), "attachment_archive");
        // the part of Word without the content-types file
        assert_eq!(classify("docx", &zip_of(&[("word/document.xml", b"<x/>")])).unwrap_err(), "attachment_archive");
        // an OpenDocument with a mimetype that is not first, or says something else
        assert_eq!(
            classify("odt", &zip_of(&[("content.xml", b"<x/>"), ("mimetype", b"application/vnd.oasis.opendocument.text")])).unwrap_err(),
            "attachment_archive"
        );
        assert_eq!(classify("odt", &odf("application/zip")).unwrap_err(), "attachment_archive");
    }

    #[test]
    fn a_zip_that_declares_too_much_unpacked_or_leaves_its_folder_is_an_archive() {
        // one small part that says it is 90 MB twice: the sum is over 100 MB
        let bomb = zip_declaring(&[("[Content_Types].xml", b"<x/>"), ("word/document.xml", b"<x/>")], Some(90 * 1024 * 1024));
        assert_eq!(classify("docx", &bomb).unwrap_err(), "attachment_archive");
        let up = zip_of(&[("[Content_Types].xml", b"<x/>"), ("word/document.xml", b"<x/>"), ("../evil.xml", b"x")]);
        assert_eq!(classify("docx", &up).unwrap_err(), "attachment_archive");
        let absolute = zip_of(&[("[Content_Types].xml", b"<x/>"), ("word/document.xml", b"<x/>"), ("/etc/passwd", b"x")]);
        assert_eq!(classify("docx", &absolute).unwrap_err(), "attachment_archive");
        // sizes just under the limit pass
        let fine = zip_declaring(&[("[Content_Types].xml", b"<x/>"), ("word/document.xml", b"<x/>")], Some(40 * 1024 * 1024));
        assert_eq!(kind("docx", &fine), (Kind::Word, "docx"));
        // zip64 marker in the end record: not read
        let mut sixty_four = docx();
        let end = sixty_four.len() - 22;
        let locator = b"PK\x06\x07\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0".to_vec();
        sixty_four.splice(end..end, locator);
        assert_eq!(classify("docx", &sixty_four).unwrap_err(), "attachment_archive");
        // a directory that points outside the file
        let mut broken = docx();
        let end = broken.len() - 22;
        broken[end + 16..end + 20].copy_from_slice(&0x7fff_0000u32.to_le_bytes());
        assert_eq!(classify("docx", &broken).unwrap_err(), "attachment_archive");
    }

    #[test]
    fn a_click_opens_only_what_the_system_shows_without_running_it() {
        assert!(Kind::Pdf.opens_with_a_click("pdf"));
        assert!(Kind::Word.opens_with_a_click("docx"));
        assert!(Kind::Sheet.opens_with_a_click("xlsx"));
        assert!(Kind::Slides.opens_with_a_click("pptx"));
        assert!(Kind::Image.opens_with_a_click("png"));
        assert!(Kind::Text.opens_with_a_click("txt") && Kind::Text.opens_with_a_click("md") && Kind::Text.opens_with_a_click("json"));
        assert!(!Kind::Text.opens_with_a_click("csv") && !Kind::Text.opens_with_a_click("tsv"));
        assert!(!Kind::Other.opens_with_a_click("bin"));
    }

    #[test]
    fn the_words_of_the_kinds_are_the_closed_table_of_the_contract() {
        let words: Vec<&str> = [Kind::Pdf, Kind::Word, Kind::Sheet, Kind::Slides, Kind::Image, Kind::Text, Kind::Other]
            .iter()
            .map(|k| k.word())
            .collect();
        assert_eq!(words, ["pdf", "word", "sheet", "slides", "image", "text", "other"]);
    }
}
