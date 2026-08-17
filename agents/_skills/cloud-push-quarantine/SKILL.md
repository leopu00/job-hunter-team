---
name: cloud-push-quarantine
description: Inspect and recover rows isolated by cloud push after a server rejection, without exposing row contents. Use when sync-health reports push_quarantine.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — inspect, retry, resolve

The push keeps valid data moving and stores only privacy-safe metadata for a
rejected row: table/type, opaque identity, sanitized reason, attempts and
timestamps. Never ask for or print the source row.

1. Inspect with `jht cloud quarantine list`. Report only count, table, opaque
   identity, reason code, attempts and timestamps.
2. Fix the local cause through the owning workflow. Do not edit `jobs.db` by
   hand and do not special-case a table or error code.
3. Retry with `jht cloud quarantine retry <opaque-id>`. This uses the canonical
   cloud writer. Read the result, then list again: success means `resolved`.
4. Use `jht cloud quarantine resolve <opaque-id> --confirm` only when you have
   verified that the local row was intentionally removed or superseded and no
   retry is required. Resolution keeps the audit history.

`retry all` is allowed only after one shared cause was fixed and every listed
table was checked. Never copy message bodies, titles, paths, user IDs, server
details or credentials into chat, logs or the logbook.
