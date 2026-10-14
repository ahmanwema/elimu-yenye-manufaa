import { describe, expect, it } from "vitest";
import {
  ageInYears,
  evaluateRecordingEligibility,
  minorStatus,
  RECORDING_CONSENT_POLICY,
  type LiveConsent,
} from "@/server/authz/recording-consent";
import { T } from "../support/fixture";

// TEST-ONLY threshold. The real threshold is an open owner decision; RECORDING_CONSENT_POLICY
// ships with null (fail closed), which is asserted below.
const POLICY = { minorAgeThresholdYears: 18 };
const NOW = new Date("2026-10-14T12:00:00Z");
const date = (s: string) => new Date(`${s}T00:00:00Z`);

const guardian = (active = true): LiveConsent => ({ id: "g", method: "GUARDIAN_ONLINE", tenantId: null, guardianLinkActive: active });
const offline = (tenantId: string): LiveConsent => ({ id: "o", method: "OFFLINE_VERIFIED", tenantId, guardianLinkActive: false });

describe("minor status is derived from the date of birth (A70)", () => {
  it("counts completed years, birthday-exact", () => {
    expect(ageInYears(date("2008-10-14"), NOW)).toBe(18);
    expect(ageInYears(date("2008-10-15"), NOW)).toBe(17);
    expect(ageInYears(date("2008-02-29"), date("2026-02-28"))).toBe(17);
  });

  it("MINOR / ADULT follow the configured threshold; unknown without a DOB or a threshold", () => {
    expect(minorStatus(date("2012-01-01"), NOW, POLICY)).toBe("MINOR");
    expect(minorStatus(date("2000-01-01"), NOW, POLICY)).toBe("ADULT");
    expect(minorStatus(null, NOW, POLICY)).toBe("UNKNOWN");
    expect(minorStatus(date("2012-01-01"), NOW, { minorAgeThresholdYears: null })).toBe("UNKNOWN");
  });

  it("ships fail-closed: the age threshold is NOT decided, so it is null", () => {
    expect(RECORDING_CONSENT_POLICY.minorAgeThresholdYears).toBeNull();
    const result = evaluateRecordingEligibility({ dateOfBirth: date("2015-01-01"), consents: [guardian()], tenantId: T.A, now: NOW, policy: RECORDING_CONSENT_POLICY });
    expect(result).toEqual({ eligible: false, eligibility: "AGE_POLICY_UNSET" });
  });
});

describe("recording eligibility (one policy for clips and full recordings, A72)", () => {
  const minor = date("2015-01-01");
  const evaluate = (consents: LiveConsent[], dateOfBirth: Date | null = minor, tenantId: string = T.A) =>
    evaluateRecordingEligibility({ dateOfBirth, consents, tenantId, now: NOW, policy: POLICY });

  it("a minor without consent cannot be recorded", () => {
    expect(evaluate([])).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
  });

  it("an ACTIVE guardian's online consent applies in every Markaz", () => {
    expect(evaluate([guardian()], minor, T.A)).toMatchObject({ eligible: true, consentId: "g" });
    expect(evaluate([guardian()], minor, T.B)).toMatchObject({ eligible: true });
  });

  it("a guardian whose link is no longer ACTIVE no longer counts", () => {
    expect(evaluate([guardian(false)])).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
  });

  it("verified offline consent applies in the verifying Markaz only", () => {
    expect(evaluate([offline(T.A)], minor, T.A)).toMatchObject({ eligible: true, consentId: "o" });
    expect(evaluate([offline(T.A)], minor, T.B)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
  });

  it("fails closed without a DOB, and for adults (adult consent flow not decided)", () => {
    expect(evaluate([guardian()], null)).toEqual({ eligible: false, eligibility: "DATE_OF_BIRTH_MISSING" });
    expect(evaluate([guardian(), offline(T.A)], date("2000-01-01"))).toEqual({ eligible: false, eligibility: "ADULT_CONSENT_UNDECIDED" });
  });
});
