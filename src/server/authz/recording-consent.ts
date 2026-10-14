// Recording-consent policy (owner decisions 2026-10-14, A70–A72). Pure: no I/O, so every
// rule is unit-testable. One policy covers BOTH correction audio clips and full recordings.
//
// Recording eligibility is NOT live participation: a student without valid consent may still
// join, listen, speak and receive a live mic grant — only their audio must stay out of
// recorded media. Nothing in the live-class path consults this module.
//
// Fail-closed until the owner decides two open points:
//   - the age threshold that makes a student a minor (no jurisdiction-aware rule exists);
//   - who consents for an ADULT student, and how.
// Until then: unknown threshold → nobody is eligible; adults → not eligible.

export type ConsentPolicy = {
  /** Age (in completed years) at which a student stops being a minor. null = undecided. */
  minorAgeThresholdYears: number | null;
};

/** OWNER DECISION PENDING — do not fill in without an explicit, recorded decision. */
export const RECORDING_CONSENT_POLICY: ConsentPolicy = { minorAgeThresholdYears: null };

export type ConsentMethod = "GUARDIAN_ONLINE" | "OFFLINE_VERIFIED";

/** A live (un-withdrawn) consent, with what is needed to judge it today. */
export type LiveConsent = {
  id: string;
  method: ConsentMethod;
  /** OFFLINE_VERIFIED: the Markaz where it was verified (applies there only). Online: null. */
  tenantId: string | null;
  /** GUARDIAN_ONLINE: does the consenting guardian STILL hold an ACTIVE link to the student? */
  guardianLinkActive: boolean;
};

export type Eligibility = "CONSENTED" | "NO_CONSENT" | "DATE_OF_BIRTH_MISSING" | "AGE_POLICY_UNSET" | "ADULT_CONSENT_UNDECIDED";

export type EligibilityResult =
  | { eligible: true; eligibility: "CONSENTED"; consentId: string }
  | { eligible: false; eligibility: Exclude<Eligibility, "CONSENTED"> };

export type MinorStatus = "MINOR" | "ADULT" | "UNKNOWN";

/** Completed years between a calendar date of birth and `now` (UTC calendar dates). */
export function ageInYears(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Minor status is ALWAYS derived from the date of birth — never stored (A70). */
export function minorStatus(dateOfBirth: Date | null, now: Date, policy: ConsentPolicy): MinorStatus {
  if (!dateOfBirth || policy.minorAgeThresholdYears === null) return "UNKNOWN";
  return ageInYears(dateOfBirth, now) < policy.minorAgeThresholdYears ? "MINOR" : "ADULT";
}

/**
 * May this student's audio be captured into recorded media (a correction clip or a full
 * recording) in this Markaz, now?
 * - Minor: a live GUARDIAN_ONLINE consent from a guardian who still holds an ACTIVE link
 *   (valid in every Markaz), or a live OFFLINE_VERIFIED consent recorded in THIS Markaz.
 * - Everything else fails closed with the reason.
 */
export function evaluateRecordingEligibility(input: {
  dateOfBirth: Date | null;
  consents: readonly LiveConsent[];
  tenantId: string;
  now: Date;
  policy: ConsentPolicy;
}): EligibilityResult {
  const { dateOfBirth, consents, tenantId, now, policy } = input;
  if (!dateOfBirth) return { eligible: false, eligibility: "DATE_OF_BIRTH_MISSING" };
  if (policy.minorAgeThresholdYears === null) return { eligible: false, eligibility: "AGE_POLICY_UNSET" };
  if (minorStatus(dateOfBirth, now, policy) === "ADULT") return { eligible: false, eligibility: "ADULT_CONSENT_UNDECIDED" };

  const valid = consents.find(
    (c) =>
      (c.method === "GUARDIAN_ONLINE" && c.guardianLinkActive) ||
      (c.method === "OFFLINE_VERIFIED" && c.tenantId === tenantId),
  );
  return valid ? { eligible: true, eligibility: "CONSENTED", consentId: valid.id } : { eligible: false, eligibility: "NO_CONSENT" };
}
