# Agent usage and terminal monitor

`jht agents --usage` lists the team's real instances, including numbered
workers, the doctor and the maintainer. Stopped instances remain visible if
the Sentinel has a usage reading for them. `--json` returns the same facts.
`jht team status` uses this inventory too.

`jht monitor` refreshes in the current terminal every three seconds. Ctrl-C
closes this view only. On a pipe use `jht monitor --once` or `--json`; JSON
is one snapshot, not an endless stream. Opening a new terminal window is a
separate extension and is not required for this command.

Tokens are weighted tokens from the Sentinel's existing meter, over a rolling
hour. Its timestamp and age are shown. The meter normally refreshes every
five minutes. Missing, invalid or older-than-fifteen-minute readings are N/D;
an instance absent from the meter is N/D, while an explicit zero stays zero.
These numbers are neither money, account quota nor tokens per second.

Model and effort come from the newest structured session records of the
active CLI, never its launch arguments or the role's defaults. The observer
refreshes those records at most every fifteen seconds. A model changed
without a new record cannot be observed yet. Providers without those fields
show N/D. A running process alone says nothing about whether work is being
done; activity uses the same CLI event rules as the agents panel.

Linux process measurements include the pane's observed process descendants.
CPU is their sampled CPU time divided by elapsed time and guest CPU count.
The first sample and newly observed process identities have no CPU delta:
N/D. RSS includes shared pages; its bar is relative to guest physical memory,
not unique memory consumption. Processes that start and exit between samples,
the VM itself, host processes and Windows bridges are not measured. If proc
is unavailable, those measurements are N/D; the usage and session view still
works. A read failure is reported and recorded as a diagnostic code in
`runtime.log`; no session text or credentials are copied to that log.
