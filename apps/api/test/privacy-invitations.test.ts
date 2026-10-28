import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, as, cookieFrom, freshIp, makeFacility, makeUser, prisma, resetDatabase, tokenFor, totp } from "./helpers.js";
import { noticeTemplate } from "../src/routes/facility/privacy.js";

beforeEach(resetDatabase);

const NEW_PASSWORD = "maternity ward night roster";
const TINY_JPEG = "data:image/jpeg;base64," + Buffer.from("not really a jpeg but base64").toString("base64");

async function setup() {
  const facility = await makeFacility("Sombo Health Centre");
  const { user: admin } = await makeUser({ role: "FACILITY_ADMIN", facilityId: facility.id, withStaff: { fullName: "Kofi Bawa" } });
  const api = as(admin);
  const staff = (
    await api.post("/api/facility/staff", { staffNo: "S1", fullName: "Abena Dery", employmentStatus: "PERMANENT", email: "abena@sombo.test" })
  ).body.staff;
  return { facility, admin, api, staff };
}

async function publishNotice(api: ReturnType<typeof as>) {
  const body = noticeTemplate("Sombo Health Centre").replace("[name and email of the facility's contact]", "Kofi Bawa, kofi@sombo.test");
  return api.post("/api/facility/privacy/notices", { body });
}

const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
const pub = (path: string, body: object) => request(app).post(path).set("X-Forwarded-For", freshIp()).send(body);

describe("privacy notice", () => {
  it("refuses the template with its placeholder, and versions each publication", async () => {
    const { api } = await setup();
    const raw = await api.post("/api/facility/privacy/notices", { body: noticeTemplate("Sombo Health Centre") });
    expect(raw.status).toBe(400);
    expect(raw.body.fields.body).toMatch(/Replace the placeholder/);

    expect((await publishNotice(api)).body.notice.version).toBe("1");
    expect((await publishNotice(api)).body.notice.version).toBe("2");
    const list = await api.get("/api/facility/privacy/notices");
    expect(list.body.notices.map((n: { version: string }) => n.version)).toEqual(["2", "1"]);
  });
});

describe("invitations", () => {
  it("cannot be sent before a privacy notice is published, or to someone without an email", async () => {
    const { api, staff, facility } = await setup();
    const blocked = await api.post(`/api/facility/staff/${staff.id}/invite`, { role: "STAFF" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Publish your facility's privacy notice first/);

    await publishNotice(api);
    const noEmail = await prisma.staff.create({ data: { facilityId: facility.id, staffNo: "S2", fullName: "Yaw Mensah", status: "ACTIVE" } });
    const r = await api.post(`/api/facility/staff/${noEmail.id}/invite`, { role: "STAFF" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Add an email address to Yaw Mensah's record first/);
  });

  it("stores only a fingerprint of the link, and a new invitation cancels the old one", async () => {
    const { api, staff } = await setup();
    await publishNotice(api);
    const first = await api.post(`/api/facility/staff/${staff.id}/invite`, { role: "STAFF" });
    expect(first.status).toBe(201);
    const raw = tokenOf(first.body.url);
    expect(await prisma.staffInvitation.count({ where: { token: raw } })).toBe(0);

    const second = await api.post(`/api/facility/staff/${staff.id}/invite`, { role: "SUPERVISOR" });
    expect((await request(app).get(`/api/invitations/check?token=${tokenOf(first.body.url)}`)).body.status).toBe("invalid");
    const check = await request(app).get(`/api/invitations/check?token=${tokenOf(second.body.url)}`);
    expect(check.body).toMatchObject({ status: "ok", fullName: "Abena Dery", email: "abena@sombo.test", role: "SUPERVISOR", mfaRequired: true });
    expect(check.body.notice.version).toBe("1");
  });

  it("accepting records the notice version, sets the password, then sets up the access code before signing in", async () => {
    const { api, staff, facility } = await setup();
    await publishNotice(api);
    const token = tokenOf((await api.post(`/api/facility/staff/${staff.id}/invite`, { role: "STAFF" })).body.url);

    const stale = await pub("/api/invitations/accept", { token, password: NEW_PASSWORD, acceptedNoticeVersion: "0" });
    expect(stale.status).toBe(409);
    const weak = await pub("/api/invitations/accept", { token, password: "short", acceptedNoticeVersion: "1" });
    expect(weak.body.fields.password).toMatch(/at least 12/);

    const ok = await pub("/api/invitations/accept", { token, password: NEW_PASSWORD, acceptedNoticeVersion: "1" });
    expect(ok.status).toBe(200);
    expect(ok.body.next).toBe("mfa_setup");
    expect(ok.headers["set-cookie"]).toBeUndefined();
    const start = await pub("/api/auth/mfa/enrol/start", { enrolmentToken: ok.body.enrolmentToken });
    const finish = await pub("/api/auth/mfa/enrol/finish", {
      enrolmentToken: ok.body.enrolmentToken,
      setupToken: start.body.setupToken,
      totp: totp(start.body.secret),
    });
    expect(finish.status).toBe(200);
    cookieFrom(finish);
    expect(finish.body.recoveryCodes.length).toBeGreaterThan(0);

    const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userEmail: "abena@sombo.test" } });
    expect(profile.privacyNoticeVersionAccepted).toBe("1");
    expect(profile.staffId).toBe(staff.id);
    expect(profile.facilityId).toBe(facility.id);
    expect(profile.mfaEnabled).toBe(true);

    // From now on sign-in needs the email, the password and the code.
    const noCode = await pub("/api/auth/login", { email: "abena@sombo.test", password: NEW_PASSWORD });
    expect(noCode.body.mfaRequired).toBe(true);
    const withCode = await pub("/api/auth/login", { email: "abena@sombo.test", password: NEW_PASSWORD, totp: totp(start.body.secret) });
    expect(withCode.status).toBe(200);
    expect(withCode.body.accessToken).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "invitation_accepted" } });
    expect(audit?.summary).toBe(
      "Abena Dery accepted their invitation, agreed to version 1 of the privacy notice and created a HealthFlow account as Staff."
    );
    expect((await request(app).get(`/api/invitations/check?token=${token}`)).body.status).toBe("used");
  });

  it("an invited admin must set up two-step sign-in before the first session", async () => {
    const { api, staff } = await setup();
    await publishNotice(api);
    const token = tokenOf((await api.post(`/api/facility/staff/${staff.id}/invite`, { role: "FACILITY_ADMIN" })).body.url);
    const res = await pub("/api/invitations/accept", { token, password: NEW_PASSWORD, acceptedNoticeVersion: "1" });
    expect(res.body.next).toBe("mfa_setup");
    expect(res.headers["set-cookie"]).toBeUndefined();
    const start = await pub("/api/auth/mfa/enrol/start", { enrolmentToken: res.body.enrolmentToken });
    const finish = await pub("/api/auth/mfa/enrol/finish", {
      enrolmentToken: res.body.enrolmentToken,
      setupToken: start.body.setupToken,
      totp: totp(start.body.secret),
    });
    expect(finish.status).toBe(200);
  });

  it("an expired invitation is refused", async () => {
    const { api, staff } = await setup();
    await publishNotice(api);
    const token = tokenOf((await api.post(`/api/facility/staff/${staff.id}/invite`, { role: "STAFF" })).body.url);
    await prisma.staffInvitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/api/invitations/check?token=${token}`)).body.status).toBe("expired");
    const res = await pub("/api/invitations/accept", { token, password: NEW_PASSWORD, acceptedNoticeVersion: "1" });
    expect(res.body.error).toBe("invitation_expired");
  });
});

describe("inviting by email", () => {
  it("adds the person to the staff list as pending, and they become active when they join", async () => {
    const { api, facility } = await setup();
    await publishNotice(api);
    const res = await api.post("/api/facility/invitations", { fullName: "Yaw Mensah", email: "Yaw@Sombo.test", role: "SUPERVISOR" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Yaw Mensah");
    const staff = await prisma.staff.findUniqueOrThrow({ where: { id: res.body.staffId } });
    expect(staff).toMatchObject({ email: "yaw@sombo.test", status: "PENDING", fullName: "Yaw Mensah" });
    expect(staff.staffNo).toMatch(/^TBC-/);

    const list = await api.get("/api/facility/invitations");
    const row = list.body.invitations.find((i: { email: string }) => i.email === "yaw@sombo.test");
    expect(row).toMatchObject({ status: "waiting", fullName: "Yaw Mensah", role: "SUPERVISOR" });

    const token = tokenOf(res.body.url);
    const accepted = await pub("/api/invitations/accept", { token, password: NEW_PASSWORD, acceptedNoticeVersion: "1" });
    expect(accepted.body.next).toBe("mfa_setup");
    expect((await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } })).status).toBe("ACTIVE");
    const after = (await api.get("/api/facility/invitations")).body.invitations.find((i: { email: string }) => i.email === "yaw@sombo.test");
    expect(after.status).toBe("joined");
    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id, action: "staff_created", entityId: staff.id } });
    expect(audit?.summary).toMatch(/added Yaw Mensah \(staff no\. TBC-\d+\) to the staff list while inviting them\./);
  });

  it("uses an existing staff record when the email is already on the list", async () => {
    const { api, staff } = await setup();
    await publishNotice(api);
    const res = await api.post("/api/facility/invitations", { fullName: "Whoever", email: "ABENA@sombo.test", role: "STAFF" });
    expect(res.status).toBe(201);
    expect(res.body.staffId).toBe(staff.id);
    expect(await prisma.staff.count({ where: { email: "abena@sombo.test" } })).toBe(1);
  });

  it("leaves nothing behind when it cannot be sent, and checks the email and staff number", async () => {
    const { api, facility } = await setup();
    const before = await prisma.staff.count({ where: { facilityId: facility.id } });
    const blocked = await api.post("/api/facility/invitations", { fullName: "Yaw Mensah", email: "yaw@sombo.test", role: "STAFF" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Publish your facility's privacy notice first/);
    expect(await prisma.staff.count({ where: { facilityId: facility.id } })).toBe(before);

    await publishNotice(api);
    const bad = await api.post("/api/facility/invitations", { fullName: "", email: "not-an-email", role: "STAFF" });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.email).toMatch(/valid email/);
    expect(bad.body.fields.fullName).toBe("Full name is required.");
    const dup = await api.post("/api/facility/invitations", { fullName: "Yaw Mensah", email: "yaw@sombo.test", role: "STAFF", staffNo: "S1" });
    expect(dup.body.fields.staffNo).toMatch(/already has this staff number/);
    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    const taken = await api.post("/api/facility/invitations", { fullName: "Someone", email: user.userEmail, role: "STAFF" });
    expect(taken.status).toBe(409);
  });

  it("can send a new link or cancel, and only admins can invite", async () => {
    const { api, facility } = await setup();
    await publishNotice(api);
    const first = await api.post("/api/facility/invitations", { fullName: "Yaw Mensah", email: "yaw@sombo.test", role: "STAFF" });
    const id = (await api.get("/api/facility/invitations")).body.invitations[0].id;
    const again = await api.post(`/api/facility/invitations/${id}/resend`);
    expect(again.status).toBe(201);
    expect((await request(app).get(`/api/invitations/check?token=${tokenOf(first.body.url)}`)).body.status).toBe("invalid");
    expect((await request(app).get(`/api/invitations/check?token=${tokenOf(again.body.url)}`)).body.status).toBe("ok");

    const pending = (await api.get("/api/facility/invitations")).body.invitations.find((i: { status: string }) => i.status === "waiting");
    expect((await api.post(`/api/facility/invitations/${pending.id}/revoke`)).status).toBe(200);
    expect((await request(app).get(`/api/invitations/check?token=${tokenOf(again.body.url)}`)).body.status).toBe("invalid");

    const { user } = await makeUser({ role: "STAFF", facilityId: facility.id });
    expect((await as(user).post("/api/facility/invitations", { fullName: "A B", email: "ab@sombo.test", role: "STAFF" })).status).toBe(403);
    expect((await as(user).get("/api/facility/invitations")).status).toBe(403);
  });
});

describe("consent and photographs (Part 3, 0.5 and 0.9)", () => {
  it("a photograph cannot be saved without consent, and withdrawing consent deletes it", async () => {
    const { api, staff, facility } = await setup();
    const refused = await api.put(`/api/facility/staff/${staff.id}/photo`, { dataUrl: TINY_JPEG });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("no_photo_consent");

    expect((await api.post(`/api/facility/staff/${staff.id}/consents`, { consentType: "PHOTOGRAPH" })).status).toBe(201);
    expect((await api.post(`/api/facility/staff/${staff.id}/consents`, { consentType: "PHOTOGRAPH" })).status).toBe(409);
    expect((await api.put(`/api/facility/staff/${staff.id}/photo`, { dataUrl: TINY_JPEG })).status).toBe(200);
    expect((await api.get(`/api/facility/staff/${staff.id}`)).body.staff.photo).toBe(TINY_JPEG);

    const consents = await api.get(`/api/facility/staff/${staff.id}/consents`);
    const photo = consents.body.consents.find((c: { consentType: string }) => c.consentType === "PHOTOGRAPH");
    expect(photo.active).toBe(true);

    const w = await api.post(`/api/facility/staff/${staff.id}/consents/${photo.latest.id}/withdraw`);
    expect(w.body.photoDeleted).toBe(true);
    const after = await prisma.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.photoUrl).toBeNull();
    expect(after.photoConsentId).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { facilityId: facility.id }, orderBy: { createdAt: "desc" } });
    expect(audit?.summary).toBe("Kofi Bawa recorded that Abena Dery withdrew consent to a photograph on their record. The photograph was deleted.");
  });

  it("the staff list never carries photographs", async () => {
    const { api, staff } = await setup();
    await api.post(`/api/facility/staff/${staff.id}/consents`, { consentType: "PHOTOGRAPH" });
    await api.put(`/api/facility/staff/${staff.id}/photo`, { dataUrl: TINY_JPEG });
    const list = await api.get("/api/facility/staff");
    expect(JSON.stringify(list.body)).not.toContain("data:image");
  });
});

describe("retention", () => {
  it("starts as unapproved proposals; approving and changing behave as the spec says", async () => {
    const { api } = await setup();
    const first = await api.get("/api/facility/privacy/retention");
    expect(first.body.policies).toHaveLength(8);
    expect(first.body.policies.every((p: { approved: boolean }) => !p.approved)).toBe(true);
    const audit = first.body.policies.find((p: { entityType: string }) => p.entityType === "AuditLog");
    expect(audit.retentionMonths).toBe(84);

    await api.post(`/api/facility/privacy/retention/${audit.id}/approve`);
    let row = (await api.get("/api/facility/privacy/retention")).body.policies.find((p: { id: string }) => p.id === audit.id);
    expect(row.approved).toBe(true);

    await api.patch(`/api/facility/privacy/retention/${audit.id}`, { retentionMonths: 96, basisNote: null });
    row = (await api.get("/api/facility/privacy/retention")).body.policies.find((p: { id: string }) => p.id === audit.id);
    expect(row.approved).toBe(false);
    expect(row.retentionMonths).toBe(96);
  });
});

describe("errors and system health", () => {
  it("a report needs a description; automatic reports are accepted", async () => {
    const { admin } = await setup();
    expect((await as(admin).post("/api/errors", { kind: "report", description: "broken" })).status).toBe(400);
    expect((await as(admin).post("/api/errors", { kind: "report", screen: "/staff", description: "The staff list did not load this morning." })).status).toBe(201);
    expect((await as(admin).post("/api/errors", { kind: "automatic", screen: "/roster", description: "TypeError: x is undefined", context: { token: "abc" } })).status).toBe(201);
    const stored = await prisma.errorReport.findFirstOrThrow({ where: { screen: "/roster" } });
    expect(JSON.stringify(stored.technicalContext)).not.toContain("abc");
  });

  it("only platform admins see system health, and can change a report's status", async () => {
    const { admin } = await setup();
    await as(admin).post("/api/errors", { kind: "report", screen: "/staff", description: "The staff list did not load this morning." });
    expect((await as(admin).get("/api/platform/health")).status).toBe(404);
    const { user: platform } = await makeUser({ role: "PLATFORM_ADMIN" });
    const health = await as(platform).get("/api/platform/health");
    expect(health.status).toBe(200);
    expect(health.body.database.ok).toBe(true);
    expect(health.body.errors.open).toBe(1);
    expect(health.body.reports[0].facility).toBe("Sombo Health Centre");
    const id = health.body.reports[0].id;
    expect((await as(platform).patch(`/api/platform/errors/${id}`, { status: "RESOLVED" })).status).toBe(200);
    expect((await as(platform).get("/api/platform/health")).body.errors.open).toBe(0);
  });

  it("a malformed request body is a 400, not a server error", async () => {
    const { admin } = await setup();
    const res = await request(app)
      .post("/api/facility/departments")
      .set("Authorization", `Bearer ${tokenFor(admin)}`)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(await prisma.errorReport.count()).toBe(0);
  });
});
