import { describe, expect, it } from "vitest";
import {
  ageInYears,
  evaluateRecordingEligibility,
  minorStatus,
  RECORDING_CONSENT_POLICY,
  type LiveConsent,
} from "@/server/authz/recording-consent";
import { T } from "../support/fixture";

const NOW = new Date("2026-10-14T12:00:00Z");
const date = (s: string) => new Date(`${s}T00:00:00Z`);

const guardian = (active = true): LiveConsent => ({ id: "g", method: "GUARDIAN_ONLINE", tenantId: null, guardianLinkActive: active });
const offline = (tenantId: string): LiveConsent => ({ id: "o", method: "OFFLINE_VERIFIED", tenantId, guardianLinkActive: false });
const self: LiveConsent = { id: "s", method: "SELF_ONLINE", tenantId: null, guardianLinkActive: false };

describe("age: minor = under 18, derived from the date of birth (A70, A81)", () => {
  it("the approved threshold is 18", () => {
    expect(RECORDING_CONSENT_POLICY.minorAgeThresholdYears).toBe(18);
  });

  it("17 is a minor, 18 is an adult — exactly on the birthday", () => {
    expect(minorStatus(date("2008-10-15"), NOW)).toBe("MINOR"); // turns 18 tomorrow
    expect(minorStatus(date("2008-10-14"), NOW)).toBe("ADULT"); // 18th birthday today
    expect(minorStatus(date("2009-10-14"), NOW)).toBe("MINOR"); // 17 today
    expect(ageInYears(date("2008-10-15"), NOW)).toBe(17);
    expect(ageInYears(date("2008-02-29"), date("2026-02-28"))).toBe(17);
    expect(ageInYears(date("2008-02-29"), date("2026-03-01"))).toBe(18);
  });

  it("no DOB → status unknown", () => {
    expect(minorStatus(null, NOW)).toBe("UNKNOWN");
  });
});

describe("recording eligibility (one policy for clips and full recordings, A72, A81–A83)", () => {
  const minor = date("2015-01-01");
  const adult = date("2000-01-01");
  const evaluate = (consents: LiveConsent[], dateOfBirth: Date | null = minor, verified = true, tenantId: string = T.A) =>
    evaluateRecordingEligibility({ dateOfBirth, dateOfBirthVerified: verified, consents, tenantId, now: NOW });

  it("an unverified DOB fails closed, whatever consent exists", () => {
    expect(evaluate([guardian(), offline(T.A)], minor, false)).toEqual({ eligible: false, eligibility: "DATE_OF_BIRTH_UNVERIFIED" });
    expect(evaluate([self], adult, false)).toEqual({ eligible: false, eligibility: "DATE_OF_BIRTH_UNVERIFIED" });
    expect(evaluate([guardian()], null)).toEqual({ eligible: false, eligibility: "DATE_OF_BIRTH_MISSING" });
  });

  it("minor: no consent → not eligible; an ACTIVE guardian's consent → eligible in every Markaz", () => {
    expect(evaluate([])).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
    expect(evaluate([guardian()], minor, true, T.A)).toMatchObject({ eligible: true, consentId: "g" });
    expect(evaluate([guardian()], minor, true, T.B)).toMatchObject({ eligible: true });
    expect(evaluate([guardian(false)])).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
  });

  it("minor: verified offline consent applies in the verifying Markaz only; self-consent does not count", () => {
    expect(evaluate([offline(T.A)], minor, true, T.A)).toMatchObject({ eligible: true, consentId: "o" });
    expect(evaluate([offline(T.A)], minor, true, T.B)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
    expect(evaluate([self], minor)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
  });

  it("adult: only their OWN consent counts — a guardian or offline consent cannot substitute", () => {
    expect(evaluate([self], adult)).toMatchObject({ eligible: true, consentId: "s" });
    expect(evaluate([guardian(), offline(T.A)], adult)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
    expect(evaluate([], adult)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
  });
});
