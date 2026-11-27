"use server";

import type { ActionResult } from "@/lib/action-result";
import {
  addClassSchedule,
  archiveClass,
  assignClassTeacher,
  createClass,
  endClassSchedule,
  removeCoTeacher,
  setTenantCapacityLimits,
  setTenantTimezone,
  updateClass,
} from "@/server/services/classes";
import {
  admitFromWaitlist,
  endEnrollment,
  enrollStudent,
  extendGrace,
  rejectPayment,
  submitPaymentEvidence,
  verifyPayment,
} from "@/server/services/enrollments";
import {
  adjustAttendance,
  assignSubstitute,
  cancelSession,
  createScheduledSession,
  endSession,
  generateSessionsFromSchedule,
  grantMic,
  grantWhiteboard,
  joinSession,
  leaveSession,
  lowerHand,
  postChatMessage,
  raiseHand,
  removeParticipant,
  revokeMic,
  revokeWhiteboard,
  startAdHocSession,
  startSession,
} from "@/server/services/live-sessions";
import { correctRecordingParticipants, startSessionRecording, stopSessionRecording } from "@/server/services/session-recording";
import { cookies } from "next/headers";
import type { PrismaClient } from "@/generated/prisma/client";
import { getRtcProvider } from "@/server/rtc";
import { DomainError } from "@/server/services/errors";
import { issueAudioToken, sessionIdOfOwnConnection, sessionIdOfParticipant, syncSessionAudio } from "@/server/services/live-audio";
import { getCurrentActor } from "@/server/auth";
import { getDb } from "@/server/db";
import { field, runAsActor, toResultCode } from "./run";

// Live Class actions (2026-10-19). Every export here is a PUBLIC endpoint: each delegates to a
// service that authorizes the actor (tenant, class and session relation) before any database
// access. The scheduled-job entry points (closeStaleSessions, advanceEnrollmentStates) are
// deliberately NOT exposed (tests/unit/auth-safety.test.ts pins this list).

const optionalInt = (formData: FormData, name: string) => {
  const v = field(formData, name)?.trim();
  return v ? Number(v) : null;
};
const optionalText = (formData: FormData, name: string) => field(formData, name)?.trim() || undefined;
const checked = (formData: FormData, name: string) => formData.get(name) === "on" || formData.get(name) === "true";

// --- Markaz settings -----------------------------------------------------------------------
export async function setTimezoneAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => setTenantTimezone(db, actor, { tenantId: field(formData, "tenantId"), timezone: field(formData, "timezone") }));
}

export async function setCapacityLimitsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    setTenantCapacityLimits(db, actor, {
      tenantId: field(formData, "tenantId"),
      classEnrollmentCapacityMax: optionalInt(formData, "classEnrollmentCapacityMax"),
      classLiveCapacityMax: optionalInt(formData, "classLiveCapacityMax"),
    }),
  );
}

// --- Classes -------------------------------------------------------------------------------
export async function createClassAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await createClass(db, actor, {
      tenantId: field(formData, "tenantId"),
      name: field(formData, "name"),
      subject: optionalText(formData, "subject"),
      description: optionalText(formData, "description"),
      primaryTeacherProfileId: field(formData, "primaryTeacherProfileId"),
      enrollmentCapacity: optionalInt(formData, "enrollmentCapacity"),
      liveCapacity: optionalInt(formData, "liveCapacity"),
      paymentRequired: checked(formData, "paymentRequired"),
    });
  });
}

export async function updateClassAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    updateClass(db, actor, {
      classId: field(formData, "classId"),
      name: field(formData, "name"),
      subject: field(formData, "subject") ?? "",
      description: field(formData, "description") ?? "",
      enrollmentCapacity: optionalInt(formData, "enrollmentCapacity"),
      liveCapacity: optionalInt(formData, "liveCapacity"),
      // An unticked checkbox sends nothing: the hidden marker says the form carried the field.
      paymentRequired: formData.has("paymentRequiredField") ? checked(formData, "paymentRequired") : undefined,
    }),
  );
}

export async function archiveClassAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => archiveClass(db, actor, { classId: field(formData, "classId") }));
}

export async function assignTeacherAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    assignClassTeacher(db, actor, { classId: field(formData, "classId"), teacherProfileId: field(formData, "teacherProfileId"), role: field(formData, "role") }),
  );
}

export async function removeCoTeacherAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => removeCoTeacher(db, actor, { assignmentId: field(formData, "assignmentId") }));
}

export async function addScheduleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await addClassSchedule(db, actor, {
      classId: field(formData, "classId"),
      weekday: field(formData, "weekday"),
      startTime: field(formData, "startTime"),
      durationMinutes: field(formData, "durationMinutes"),
      validFrom: optionalText(formData, "validFrom"),
      validUntil: optionalText(formData, "validUntil"),
    });
  });
}

export async function endScheduleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => endClassSchedule(db, actor, { scheduleId: field(formData, "scheduleId") }));
}

// --- Enrollment, grace, payment ---------------------------------------------------------------
export async function enrollStudentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await enrollStudent(db, actor, {
      classId: field(formData, "classId"),
      studentProfileId: field(formData, "studentProfileId"),
      overrideReason: optionalText(formData, "overrideReason"),
    });
  });
}

export async function admitFromWaitlistAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    admitFromWaitlist(db, actor, {
      enrollmentId: field(formData, "enrollmentId"),
      overrideReason: optionalText(formData, "overrideReason"),
      queueOverrideReason: optionalText(formData, "queueOverrideReason"),
    }),
  );
}

export async function endEnrollmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => endEnrollment(db, actor, { enrollmentId: field(formData, "enrollmentId") }));
}

export async function extendGraceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    extendGrace(db, actor, { enrollmentId: field(formData, "enrollmentId"), graceUntil: field(formData, "graceUntil"), reason: field(formData, "reason") }),
  );
}

export async function submitPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await submitPaymentEvidence(db, actor, {
      tenantId: field(formData, "tenantId"),
      studentProfileId: field(formData, "studentProfileId"),
      enrollmentIds: formData.getAll("enrollmentIds").filter((v): v is string => typeof v === "string"),
      coverageNote: field(formData, "coverageNote"),
      evidenceReference: field(formData, "evidenceReference"),
      periodStart: field(formData, "periodStart"),
      periodEnd: field(formData, "periodEnd"),
    });
  });
}

export async function verifyPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => verifyPayment(db, actor, { submissionId: field(formData, "submissionId") }));
}

export async function rejectPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => rejectPayment(db, actor, { submissionId: field(formData, "submissionId"), reason: optionalText(formData, "reason") }));
}

// --- Sessions ---------------------------------------------------------------------------------
export async function createSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await createScheduledSession(db, actor, {
      classId: field(formData, "classId"),
      date: field(formData, "date"),
      startTime: field(formData, "startTime"),
      durationMinutes: field(formData, "durationMinutes"),
      title: optionalText(formData, "title"),
      recordingEnabled: checked(formData, "recordingEnabled"),
    });
  });
}

export async function generateSessionsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await generateSessionsFromSchedule(db, actor, { classId: field(formData, "classId"), fromDate: field(formData, "fromDate"), days: field(formData, "days") });
  });
}

export async function startAdHocSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await startAdHocSession(db, actor, {
      classId: field(formData, "classId"),
      durationMinutes: optionalInt(formData, "durationMinutes") ?? undefined,
      title: optionalText(formData, "title"),
      recordingEnabled: checked(formData, "recordingEnabled"),
    });
  });
}

export async function startSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => startSession(db, actor, { sessionId: field(formData, "sessionId") }));
}

export async function endSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const sessionId = field(formData, "sessionId");
    await endSession(db, actor, { sessionId });
    await syncAudio(db, sessionId ?? null); // the session is no longer LIVE: closes the room
  });
}

export async function cancelSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => cancelSession(db, actor, { sessionId: field(formData, "sessionId"), reason: optionalText(formData, "reason") }));
}

export async function assignSubstituteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    assignSubstitute(db, actor, { sessionId: field(formData, "sessionId"), substituteProfileId: field(formData, "substituteProfileId") || null }),
  );
}

// --- Live participation ----------------------------------------------------------------------------
// Audio (media plan M1): after a change that affects who may speak or who is in the room, the
// room is brought in line with the database (syncSessionAudio). Without LiveKit configured the
// page stays the business-state shell and nothing is synced.

/** Cookie that remembers which connection is THIS browser's device for a session. */
const deviceCookie = (sessionId: string) => `lc_device_${sessionId}`;

async function syncAudio(db: PrismaClient, sessionId: string | null, leftConnectionIds: string[] = []) {
  const rtc = getRtcProvider();
  if (rtc && sessionId) await syncSessionAudio(db, rtc, sessionId, leftConnectionIds);
}

export async function joinSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const sessionId = field(formData, "sessionId");
    const joined = await joinSession(db, actor, { sessionId });
    (await cookies()).set(deviceCookie(sessionId as string), joined.connectionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
  });
}

export async function leaveSessionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const connectionId = field(formData, "connectionId");
    const sessionId = await sessionIdOfOwnConnection(db, actor, connectionId);
    await leaveSession(db, actor, { connectionId });
    if (sessionId) {
      const jar = await cookies();
      if (jar.get(deviceCookie(sessionId))?.value === connectionId) jar.delete(deviceCookie(sessionId));
    }
    await syncAudio(db, sessionId, connectionId ? [connectionId] : []);
  });
}

/** Join token for this browser's own device connection (the audio component calls it). */
export async function audioTokenAction(connectionId: string): Promise<ActionResult<{ url: string; token: string; canPublishMicrophone: boolean }>> {
  // Not runAsActor: a token request changes nothing, so it must not refresh the page.
  const current = await getCurrentActor();
  if (current.state !== "signed-in") return { status: "error", code: "forbidden" };
  try {
    const rtc = getRtcProvider();
    if (!rtc) throw new DomainError("feature_not_enabled");
    const { url, token, canPublishMicrophone } = await issueAudioToken(getDb(), current.actor, rtc, { connectionId });
    return { status: "ok", data: { url, token, canPublishMicrophone } };
  } catch (error) {
    return { status: "error", code: toResultCode(error) };
  }
}

export async function raiseHandAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => raiseHand(db, actor, { sessionId: field(formData, "sessionId") }));
}

export async function lowerHandAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => lowerHand(db, actor, { participantId: field(formData, "participantId") }));
}

export async function grantMicAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const participantId = field(formData, "participantId");
    await grantMic(db, actor, { participantId });
    await syncAudio(db, await sessionIdOfParticipant(db, participantId)); // also silences a handoff's previous holder (A138)
  });
}

export async function revokeMicAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const participantId = field(formData, "participantId");
    await revokeMic(db, actor, { participantId });
    await syncAudio(db, await sessionIdOfParticipant(db, participantId));
  });
}

export async function grantWhiteboardAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => grantWhiteboard(db, actor, { participantId: field(formData, "participantId") }));
}

export async function revokeWhiteboardAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeWhiteboard(db, actor, { participantId: field(formData, "participantId") }));
}

export async function removeParticipantAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const participantId = field(formData, "participantId");
    await removeParticipant(db, actor, { participantId });
    await syncAudio(db, await sessionIdOfParticipant(db, participantId));
  });
}

export async function postChatAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await postChatMessage(db, actor, { sessionId: field(formData, "sessionId"), body: field(formData, "body") });
  });
}

export async function adjustAttendanceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    adjustAttendance(db, actor, {
      recordId: field(formData, "recordId"),
      status: field(formData, "status"),
      punctuality: formData.has("punctuality") ? field(formData, "punctuality") || null : undefined,
      reason: field(formData, "reason"),
    }),
  );
}

// --- Session recording (Option C) ----------------------------------------------------------------
export async function startSessionRecordingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    // A30/A89: the teacher must tick the confirmation; an unticked form fails validation.
    const confirmed = checked(formData, "noticeConfirmed");
    await startSessionRecording(db, actor, { sessionId: field(formData, "sessionId"), noticeShown: confirmed, teacherNoticeAcknowledged: confirmed });
  });
}

export async function stopSessionRecordingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => stopSessionRecording(db, actor, { recordingId: field(formData, "recordingId") }));
}

export async function correctRecordingParticipantsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    correctRecordingParticipants(db, actor, {
      recordingId: field(formData, "recordingId"),
      add: formData.getAll("add").filter((v): v is string => typeof v === "string" && v !== ""),
      remove: formData.getAll("remove").filter((v): v is string => typeof v === "string" && v !== ""),
    }),
  );
}
