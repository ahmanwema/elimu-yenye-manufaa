# Language Learning: Audio Dictation

Status: **DEFERRED** future module (brief Part 6.4); documented for completeness.

## Purpose
Let teachers provide authorized audio (including scholarly lectures) for students to listen to, transcribe, analyze grammatically (word types, roles, I'rab), and submit for grading — with timestamp-based links between audio segments, transcription, and grammatical analysis.

## User roles
Teacher (provides audio, grades), Student (transcribes and analyzes).

## User journey
1. Teacher uploads/links authorized audio.
2. Student listens, transcribes the spoken Arabic, identifies word types, analyzes grammatical roles, produces I'rab, and submits.
3. Teacher reviews and grades; student reviews corrections afterward.

## Functional requirements
- Audio playback with segment-level timestamp markers.
- Transcription input tied to specific timestamp ranges.
- Grammatical analysis (word type, role, I'rab) tied to the transcribed segments, reusing the same structured-answer model as [grammar-irab.md](grammar-irab.md).
- Timestamp-based linking between audio segment ↔ transcription ↔ grammatical analysis, so a teacher's correction can point precisely at "this segment, this word."

## Data requirements
Audio asset metadata (must be from an authorized/rights-cleared source — this is a content-licensing concern, not invented here), segment timestamps, transcription text per segment, grammatical analysis per segment, grade/feedback.

## Permissions
Standard tenant/enrollment scoping; audio source rights/authorization is a content-management concern for the teacher/platform, not a technical permission.

## UI states, error handling, edge cases, security considerations
Deferred to implementation-time design.

## Dependencies
[grammar-irab.md](grammar-irab.md), [../assessments.md](../assessments.md), [../audio-recording.md](../audio-recording.md) (shares audio-handling patterns).

## Acceptance criteria / testing requirements
Deferred — not scheduled.

## Open questions
How audio-source authorization/rights clearance is verified before a teacher can assign a given recording.
