import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFParse } from "pdf-parse";

async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

const getOrgScopeMock = vi.fn();
vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: getOrgScopeMock,
  requireOrgScope: async () => {
    const v = await getOrgScopeMock();
    if (!v) throw new Error("Authentication required");
    return v;
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { generateVolunteerCertificate } = await import("./volunteer-certificate");

const TEST_ORG = "test-org-vol-cert";
const TEST_USER = "test-user-vol-cert";

async function cleanup() {
  await prismaUnsafe.volunteerCertificate.deleteMany({ where: { volunteer: { organisationId: TEST_ORG } } });
  await prismaUnsafe.volunteerAssignment.deleteMany({ where: { volunteer: { organisationId: TEST_ORG } } });
  await prismaUnsafe.volunteerActivity.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.volunteer.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.certificateSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: {
      id: TEST_ORG,
      name: "Vol Test Trust",
      email: "vol@rakshana.local",
      authorisedSignatoryName: "Vol Signatory",
      authorisedSignatoryDesignation: "Coordinator",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "vol-cert@rakshana.local", name: "Vol Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: TEST_ORG, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Vol Test Trust",
    role: "OWNER",
  });
});

describe("generateVolunteerCertificate", () => {
  it("renders volunteer name, hours, period, certificate number", async () => {
    const volunteer = await prismaUnsafe.volunteer.create({
      data: {
        organisationId: TEST_ORG,
        name: "Priya Sharma",
        skills: ["teaching", "logistics"],
      },
    });
    const activity = await prismaUnsafe.volunteerActivity.create({
      data: {
        organisationId: TEST_ORG,
        name: "Diwali Distribution Drive",
        startsAt: new Date("2025-10-15T09:00:00+05:30"),
        endsAt: new Date("2025-10-15T17:00:00+05:30"),
        requiredVolunteers: 5,
      },
    });
    // 4.5 hours assignment
    await prismaUnsafe.volunteerAssignment.create({
      data: {
        volunteerId: volunteer.id,
        activityId: activity.id,
        checkInAt: new Date("2025-10-15T10:00:00+05:30"),
        checkOutAt: new Date("2025-10-15T14:30:00+05:30"),
        hours: "4.5",
      },
    });

    const result = await generateVolunteerCertificate({
      volunteerId: volunteer.id,
      periodFrom: new Date("2025-04-01"),
      periodTo: new Date("2026-03-31"),
    });

    expect(result.certificateNumber).toMatch(/^VOL\/\d{4}-\d{2}\/\d{4}$/);
    expect(result.totalHours).toBe("4.5");

    const text = await pdfText(result.buffer);
    expect(text).toContain("Priya Sharma");
    expect(text).toContain("Vol Test Trust");
    expect(text).toContain("Certificate of Appreciation");
    expect(text).toContain("4.5 hours");
    expect(text).toContain("Diwali Distribution Drive");
    // "Volunteer Coordinator" is visually present but pdf-parse drops the
    // right-column label due to z-order. The signatory line confirms the
    // signature block rendered.
    expect(text).toContain("Vol Signatory");
    expect(text).toContain(result.certificateNumber);
  });

  it("totals hours across multiple activities", async () => {
    const volunteer = await prismaUnsafe.volunteer.create({
      data: { organisationId: TEST_ORG, name: "Rajan K" },
    });
    const a1 = await prismaUnsafe.volunteerActivity.create({
      data: {
        organisationId: TEST_ORG,
        name: "Cleanup Drive",
        startsAt: new Date("2025-09-01T09:00:00+05:30"),
      },
    });
    const a2 = await prismaUnsafe.volunteerActivity.create({
      data: {
        organisationId: TEST_ORG,
        name: "Tuition Sunday",
        startsAt: new Date("2025-09-15T09:00:00+05:30"),
      },
    });
    await prismaUnsafe.volunteerAssignment.createMany({
      data: [
        { volunteerId: volunteer.id, activityId: a1.id, hours: "3" },
        { volunteerId: volunteer.id, activityId: a2.id, hours: "5.5" },
      ],
    });

    const result = await generateVolunteerCertificate({
      volunteerId: volunteer.id,
      periodFrom: new Date("2025-04-01"),
      periodTo: new Date("2026-03-31"),
    });
    expect(result.totalHours).toBe("8.5");
    const text = await pdfText(result.buffer);
    expect(text).toContain("8.5 hours");
  });
});
