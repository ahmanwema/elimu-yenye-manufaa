# RTC Pilot Phase 2 — Real-Device Runbook (owner)

**Status 2026-10-14:**
- Group A (same Wi-Fi) partly run: 1 Android phone, both providers.
- Groups B/C (hotspot/4G) **not run**. The tunnel was never opened.
- XPPen **pending hardware**. Agora co-host request **deferred** (draft below, not sent).
- Results: [rtc-pilot-results.md](rtc-pilot-results.md) §5.

Development pilot only. No vendor is chosen here (A35). Results go to `pilot/rtc/results/raw/` automatically; analysis goes to [rtc-pilot-results.md](rtc-pilot-results.md).

## Access

| Group | Who connects | URL |
|---|---|---|
| A — same Wi-Fi | Teacher PC + Android phones on the **same Wi-Fi** as the PC | `https://<PC-LAN-IP>:5443` (given in chat) |
| B — hotspot, C — 4G | Teacher PC stays on Wi-Fi. The student phone is on another phone's hotspot (B) or on mobile data (C). | temporary `https://….trycloudflare.com` URL (given in chat, only while testing) |

- **LAN certificate warning.** The LAN URL uses a local, self-signed, 7-day certificate. Chrome shows *"Your connection is not private"*. Tap **Advanced → Proceed to 192.168.x.x (unsafe)**. This is expected for this local pilot only. The tunnel URL has a normal certificate.
- **Pilot codes.** The teacher enters `PILOT_TEACHER_CODE` and each phone enters its own `PILOT_STUDENT_CODES` entry, from `pilot/rtc/.env.local`. Never share the codes in chat. More than 10 wrong codes lock that device out for 10 minutes.
- **Microphone.** On the first join, Android Chrome asks for microphone permission. Tap **Allow**.

## Before every run (all devices)

1. **Provider.** Pick the same provider on every device.
2. **Network.** Pick the real network that device is on.
3. **Device.** Write the model and browser, e.g. `Tecno Spark 10, Chrome 131` or `Windows PC, Chrome 155 + XPPen`.
4. **Scenario.** Write the label from the tables below (e.g. `A-S2`). It is recorded with every event.
5. **Teacher.** Enter the code, press **Teacher: create session**, then **Join**.
6. **Students.** Copy the room id to the phones (e.g. send it to yourself on WhatsApp). On each phone enter the code + room id, then **Join**.
7. **Notes.** Use **Note → Log note** for anything you see or hear (subjective). Example: `A-S1 voice clear, slight echo`.

**Order:** do group A with **LiveKit first, then Agora**. Next time (group B/C) do **Agora first, then LiveKit**.

## Group A — same Wi-Fi (LAN URL)

| Label | Steps | What to note |
|---|---|---|
| A-S1 | Teacher joins and speaks **with your real voice** (count 1–10). Phones join. One phone presses **Leave**, then **Join** again. | Could you hear the teacher? How long from Join until you heard audio? Did the teacher's hands list stay correct? |
| A-S2 | Phone: **Raise hand**. Teacher: **Grant**. The student talks. Teacher: **Revoke**. Repeat 3×. | Seconds from Grant until the teacher hears the student, and from Revoke until silence. |
| A-S3a | Phone **without** a grant: press **Security test: force publish** and talk. | Does the **teacher PC** hear the phone? |
| A-S3b | Phone ticks **ignore revoke**. Teacher grants, then the student talks. Teacher revokes while the student keeps talking for 10 s. | Does the teacher still hear the student after Revoke? |
| A-S4-real | While the teacher speaks, the phone turns **airplane mode ON for 10 s**, then OFF. Repeat with **30 s**. | Seconds until audio came back. Does the hands/mic state look correct afterwards? |
| A-S5 | Whiteboard, **both transports** (choose a transport and press **Use transport** on *all* devices). The teacher draws with the XPPen: short, long and rapid strokes; eraser; Undo; Clear; **Arabic word with tashkīl**, e.g. بِسْمِ اللَّهِ. Press **Ping ×10**. One phone goes airplane mode for 10 s while the teacher keeps drawing. | Is the phone board the same as the teacher's? Any missing strokes, wrong order or lag you can see? Is the Arabic readable, with the diacritics in place? |
| A-S6 | 10-minute session: the teacher talks or plays speech; one student is granted half-way through. | Any dropouts? Phone battery % at start and end. |
| A-clap | Phone next to the PC, phone muted (no grant). Clap once near the PC mic and listen to the phone. Use a slow-motion video if possible. | Approximate delay. **Subjective; label it as such.** |

## Group B — hotspot · Group C — 4G (tunnel URL)

Minimum for each provider:

- **Join + first audio:** labels B-S1 / C-S1.
- **Grant / revoke:** B-S2 / C-S2.
- **Real interruption:** C-S4-real. Toggle mobile data off for 10 s; also try **Wi-Fi → 4G switching** with network option *Switching Wi-Fi ↔ 4G*.
- **Whiteboard:** B-S5 / C-S5.
- **10-minute stability:** C-S6.

## XPPen Deco 640 (teacher PC)

Draw on the whiteboard canvas with the pen. The pilot logs `pointerType` and pressure min/max per stroke, and coalesced-event rate. Also note in **Log note**:

- whether the vendor driver is installed;
- whether the pen pressure looked right;
- any lag or jumps;
- whether Arabic + tashkīl stayed readable on the phone.

Do not uninstall drivers for this test.

## Agora co-host authentication — support request (draft, owner sends)

> Subject: Enable co-host authentication for project `<project name>` (development/pilot)
>
> Hello Agora Support,
>
> For our development project `<project name>` (App ID ending `…<last 4 chars>`), please enable **co-host authentication**, so that tokens built with `RtcRole.SUBSCRIBER` cannot publish and publish privileges can expire independently.
>
> We are evaluating server-enforced microphone control for an online classroom. Students must not be able to publish audio unless the teacher grants it, and a revoke must stop an already-flowing stream.
>
> Please also confirm:
> 1. once enabled, whether a client holding a subscriber token that calls `setClientRole("host")` + `publish()` is rejected by the server;
> 2. whether a publish privilege that expires (via `privilegeExpiredTs` for publishing audio) stops an already-publishing user, and how quickly;
> 3. whether any REST API can revoke one user's publish privilege without kicking them from the channel.
>
> Thank you.

Never include the App Certificate or tokens in the request. When support confirms, re-run S3 for Agora and record it as **"co-host authentication ON"**, separately from the default-mode results.
