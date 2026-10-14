// Recording-consent policy (owner decisions A70–A72, completed 2026-10-15 by A81–A83). Pure:
// no I/O, so every rule is unit-testable. One policy covers BOTH correction audio clips and
// full recordings.
//
// Recording eligibility is NOT live participation: a student without valid consent may still
// join, listen, speak and receive a live mic grant — only their audio must stay out of
// recorded media. Nothing in the live-class path consults this module.
//
//   Adult  (age ≥ 18, DOB VERIFIED) → eligible with their OWN live consent (SELF_ONLINE).
//   Minor  (age < 18, DOB VERIFIED) → eligible with a live guardian consent from a guardian
//                                     who still holds an ACTIVE link, or a live verified
//                                     offline consent recorded in THIS Markaz.
//   DOB missing or not yet verified by a Markaz Admin → NOT eligible (fail closed).

export type ConsentPolicy = {
  /** Age (completed years) at which a student stops being a minor. */
  minorAgeThresholdYears: number;
};

/** A81: minor = age < 18; adult = age ≥ 18. */
export const RECORDING_CONSENT_POLICY: ConsentPolicy = { minorAgeThresholdYears: 18 };

export type ConsentMethod = "GUARDIAN_ONLINE" | "OFFLINE_VERIFIED" | "SELF_ONLINE";

/** A live (un-withdrawn) consent, with what is needed to judge it today. */
export type LiveConsent = {
  id: string;
  method: ConsentMethod;
  /** OFFLINE_VERIFIED: the Markaz where it was verified (applies there only). Otherwise null. */
  tenantId: string | null;
  /** GUARDIAN_ONLINE: does the consenting guardian STILL hold an ACTIVE link to the student? */
  guardianLinkActive: boolean;
};

export type Eligibility =
  | "CONSENTED"
  | "NO_CONSENT"
  | "DATE_OF_BIRTH_MISSING"
  | "DATE_OF_BIRTH_UNVERIFIED"
  /** Legacy values from the fail-closed interim (2026-10-14); no longer produced. */
  | "AGE_POLICY_UNSET"
  | "ADULT_CONSENT_UNDECIDED";

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
export function minorStatus(dateOfBirth: Date | null, now: Date, policy: ConsentPolicy = RECORDING_CONSENT_POLICY): MinorStatus {
  if (!dateOfBirth) return "UNKNOWN";
  return ageInYears(dateOfBirth, now) < policy.minorAgeThresholdYears ? "MINOR" : "ADULT";
}

/** May this student's audio be captured into recorded media in this Markaz, now? */
export function evaluateRecordingEligibility(input: {
  dateOfBirth: Date | null;
  dateOfBirthVerified: boolean;
  consents: readonly LiveConsent[];
  tenantId: string;
  now: Date;
  policy?: ConsentPolicy;
}): EligibilityResult {
  const { dateOfBirth, dateOfBirthVerified, consents, tenantId, now, policy = RECORDING_CONSENT_POLICY } = input;
  if (!dateOfBirth) return { eligible: false, eligibility: "DATE_OF_BIRTH_MISSING" };
  if (!dateOfBirthVerified) return { eligible: false, eligibility: "DATE_OF_BIRTH_UNVERIFIED" };

  const status = minorStatus(dateOfBirth, now, policy);
  const valid =
    status === "ADULT"
      ? consents.find((c) => c.method === "SELF_ONLINE") // a guardian cannot consent for an adult
      : consents.find(
          (c) =>
            (c.method === "GUARDIAN_ONLINE" && c.guardianLinkActive) ||
            (c.method === "OFFLINE_VERIFIED" && c.tenantId === tenantId),
        );
  return valid ? { eligible: true, eligibility: "CONSENTED", consentId: valid.id } : { eligible: false, eligibility: "NO_CONSENT" };
}
