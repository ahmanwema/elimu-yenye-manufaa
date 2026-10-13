# RTC pilot — automated comparison (generated)

Generated 2026-10-13T20:41:58.864Z from 4 full runs (trial runs excluded). Values per run are separated by " / " in chronological order.

**Conditions (identical for both providers):** single Windows PC (teacher + 3 students as separate Chrome contexts); this PC's real internet connection; Chrome 155.0.8059.40; Chrome fake microphone (synthetic tone).
**Not represented:** phones, 4G/hotspot, XPPen, real voices, clap-test latency. S4 interruptions are SIMULATED (Chrome offline emulation).

| Measure | Agora | LiveKit |
|---|---|---|
| Runs (start time UTC) | 19:58:43 / 20:13:12 | 19:44:08 / 20:27:05 |
| Fatal error | none / none | none / none |
| S1 all 4 joined | true / true | true / true |
| S1 join ms (teacher, s1, s2, s3) | 4007,4773,2629,1738 / 1776,1725,1518,1538 | 960,774,811,822 / 2396,1630,1928,809 |
| S1 first audio ms (s1, s2, s3) | 6134,2912,2092 / 1969,1780,1765 | 774,811,822 / 1630,1928,809 |
| S1 teacher audio reaches all students | true / true | true / true |
| S1 participants seen by teacher (joined / after leave / after rejoin) | 0/0/0 / 0/0/0 | 3/2/3 / 3/2/3 |
| S1 rejoin ok / audio after rejoin | true / true / true / true | true / true / true / true |
| S2 grant → audio at teacher, ms (3 cycles; incl. 1 s app poll) | 3579,2365,4183 / 3770,3574,2966 | 1766,1741,1768 / 1784,1762,1775 |
| S2 revoke → silence at teacher, ms | 2354,2374,2369 / 1149,1158,1758 | 1181,540,554 / 543,638,548 |
| S2 publish errors | 0 / 0 | 2 / 3 |
| S3 force publish (no grant): audio reached teacher? | true / true | false / false |
| S3 force publish: client-side result | client reported publish success / client reported publish success | failed to publish track, insufficient permissions / failed to publish track, insufficient permissions |
| S3 ignore-revoke: still transmitting after 8 s? | true / true | false / false |
| S3 ignore-revoke: server unpublished the track? | false / false | true / true |
| S4 10 s drop: recovered / ms after restore (SIMULATED) | true / 2562 / true / 4084 | true / 1040 / true / 1047 |
| S4 30 s drop: recovered / ms after restore (SIMULATED) | true / 32862 / true / 2574 | true / 4084 / true / 4079 |
| S5 Supabase Realtime: available | true / true | true / true |
| S5 Supabase: strokes drawn by teacher | 51 / 51 | 51 / 51 |
| S5 Supabase: boards identical after drawing (order-sensitive) | false / false | false / false |
| S5 Supabase: receiver missing / out-of-order (s1,s2,s3) | 4/4 3/3 3/3 / 1/1 1/1 0/0 | 3/3 4/4 0/0 / 2/2 1/1 2/2 |
| S5 Supabase: ping RTT ms | p50 660 · p95 1342 · max 1494 (n=90) / p50 590 · p95 753 · max 845 (n=90) | p50 670 · p95 785 · max 889 (n=90) / p50 588 · p95 708 · max 849 (n=90) |
| S5 Supabase: bytes sent by teacher | 27185 / 27177 | 27178 / 27177 |
| S5 Supabase: student back after 10 s offline matches teacher? | false / false | false / false |
| S5 Supabase: identical after Clear | true / true | true / true |
| S5 LiveKit data: available | false / false | true / true |
| S5 LiveKit data: unavailable reason | this provider has no data channel in the browser SDK / this provider has no data channel in the browser SDK | — / — |
| S5 LiveKit data: boards identical after drawing | — / — | true / true |
| S5 LiveKit data: receiver missing / out-of-order |  /  | 0/0 0/0 0/0 / 0/0 0/0 0/0 |
| S5 LiveKit data: ping RTT ms | — / — | p50 223 · p95 438 · max 540 (n=90) / p50 225 · p95 302 · max 308 (n=90) |
| S5 LiveKit data: student back after 10 s offline matches teacher? | — / — | true / true |
| S6 teacher audio continuity | 2/54 samples with teacher audio flowing to all 3 students / 54/54 samples with teacher audio flowing to all 3 students | 54/54 samples with teacher audio flowing to all 3 students / 54/54 samples with teacher audio flowing to all 3 students |
| S6 disconnects / reconnects / errors (all 4) | 0/0/0 0/0/0 0/0/0 0/0/0 / 0/0/0 0/0/0 0/0/0 0/0/0 | 0/0/0 0/0/0 0/0/0 0/0/0 / 0/0/0 0/0/1 0/0/0 0/0/0 |
| S6 JS heap MB start→end (student-1) | 33→30 (max 33) / 31→30 (max 32) | 30→29 (max 31) / 30→29 (max 31) |
| RTT ms (SDK, students) | p50 226 · p95 412 · max 10000 (n=1266) / p50 188 · p95 218 · max 10000 (n=1221) | p50 100 · p95 715 · max 14952 (n=1289) / p50 100 · p95 947 · max 11633 (n=1300) |
| Jitter ms (LiveKit inbound) | — / — | p50 9 · p95 34 · max 72 (n=1289) / p50 7 · p95 31 · max 78 (n=1300) |
| Agora end2EndDelay ms | p50 414 · p95 1369 · max 5011 (n=1219) / p50 409 · p95 739 · max 15319 (n=1221) | — / — |
| Agora packet loss rate | p50 0 · p95 0.00102880658436214 · max 0.10399113082039911 (n=1219) / p50 -0.0047812723151914064 · p95 0.0016681637366867702 · max 0.056697202277791535 (n=1221) | — / — |
| Agora receive kbps | p50 0 · p95 25 · max 2479 (n=1219) / p50 24 · p95 25 · max 534 (n=1221) | — / — |
| LiveKit packets lost / received (teacher stream, 3 students) | — / — | 646 / 127412 / 413 / 129089 |
| Distinct browser errors (all participants) | 4 / 4 | 2 / 2 |
