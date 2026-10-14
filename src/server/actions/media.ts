"use server";

import type { ActionResult } from "@/lib/action-result";
import { createCorrection } from "@/server/services/corrections";
import { finalizeDirectCaptureClip, getClipPlaybackUrl, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { giveGuardianConsent, recordDateOfBirth, recordOfflineConsent, withdrawConsent } from "@/server/services/consent";
import { approveMediaDeletion, requestMediaDeletion } from "@/server/services/media-deletion";
import {
  approveRecording,
  createRecording,
  getRecordingPlaybackUrl,
  revokeRecordingApproval,
  submitRecordingForApproval,
} from "@/server/services/recordings";
import { createSupabaseObjectStorage } from "@/server/storage/supabase-storage";
import { field, runAsActor } from "./run";

// Recording & correction media actions (owner decisions 2026-10-14). Every export here is a
// public endpoint: each one calls a service that authorizes the actor itself. No action
// exposes the internal worker/purge/cleanup functions.

// --- Date of birth & consent ----------------------------------------------------------------
export async function recordDateOfBirthAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    recordDateOfBirth(db, actor, { studentProfileId: field(formData, "studentProfileId"), dateOfBirth: field(formData, "dateOfBirth") }),
  );
}

export async function giveGuardianConsentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await giveGuardianConsent(db, actor, { studentProfileId: field(formData, "studentProfileId") });
  });
}

export async function recordOfflineConsentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await recordOfflineConsent(db, actor, {
      tenantId: field(formData, "tenantId"),
      studentProfileId: field(formData, "studentProfileId"),
      consenterDescription: field(formData, "consenterDescription"),
      evidenceReference: field(formData, "evidenceReference"),
    });
  });
}

export async function withdrawConsentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await withdrawConsent(db, actor, { consentId: field(formData, "consentId") });
  });
}

// --- Corrections ----------------------------------------------------------------------------
/** The anchor comes from simple form fields; the snapshot keeps its human-readable context. */
export async function createCorrectionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const kind = field(formData, "anchorKind");
    const label = field(formData, "anchorLabel")?.trim();
    const refId = field(formData, "anchorRefId")?.trim();
    await createCorrection(db, actor, {
      tenantId: field(formData, "tenantId"),
      studentProfileId: field(formData, "studentProfileId"),
      note: field(formData, "note"),
      anchors: kind && label ? [{ kind, refId: refId || undefined, snapshot: { label } }] : [],
    });
  });
}

/** Step 1 of a clip upload: registers the clip and returns a one-time signed upload URL. */
export async function registerClipUploadAction(
  _prev: ActionResult<{ clipId: string; uploadUrl: string }>,
  formData: FormData,
): Promise<ActionResult<{ clipId: string; uploadUrl: string }>> {
  return runAsActor((db, actor) =>
    registerDirectCaptureClip(db, createSupabaseObjectStorage(), actor, {
      correctionId: field(formData, "correctionId"),
      mimeType: field(formData, "mimeType"),
    }),
  );
}

/** Step 2: the server inspects the stored file (AAC in M4A, ≤ 60 s) and finalizes it. */
export async function finalizeClipUploadAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => finalizeDirectCaptureClip(db, createSupabaseObjectStorage(), actor, { clipId: field(formData, "clipId") }));
}

export async function clipPlaybackAction(_prev: ActionResult<{ url: string }>, formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAsActor((db, actor) => getClipPlaybackUrl(db, createSupabaseObjectStorage(), actor, field(formData, "clipId")));
}

// --- Deletion ------------------------------------------------------------------------------
export async function requestMediaDeletionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await requestMediaDeletion(db, actor, {
      clipId: field(formData, "clipId") || undefined,
      recordingId: field(formData, "recordingId") || undefined,
      note: field(formData, "note") || undefined,
    });
  });
}

export async function approveMediaDeletionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => approveMediaDeletion(db, actor, { requestId: field(formData, "requestId") }));
}

// --- Recordings (metadata & approval only — no capture) -------------------------------------
export async function createRecordingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await createRecording(db, actor, { tenantId: field(formData, "tenantId"), title: field(formData, "title") });
  });
}

export async function submitRecordingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => submitRecordingForApproval(db, actor, { recordingId: field(formData, "recordingId") }));
}

export async function approveRecordingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => approveRecording(db, actor, { recordingId: field(formData, "recordingId"), scope: "WHOLE" }));
}

export async function revokeRecordingApprovalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeRecordingApproval(db, actor, { recordingId: field(formData, "recordingId") }));
}

export async function recordingPlaybackAction(_prev: ActionResult<{ url: string }>, formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAsActor((db, actor) =>
    getRecordingPlaybackUrl(db, createSupabaseObjectStorage(), actor, {
      recordingId: field(formData, "recordingId"),
      segmentId: field(formData, "segmentId") || undefined,
    }),
  );
}
