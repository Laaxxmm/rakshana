/**
 * Deterministic storage keys. Every file path the app generates flows through
 * this module so we can rename / re-layout / migrate storage without grepping
 * for string literals.
 *
 * Convention: keys are URL-safe paths, no leading slash. `org/{orgId}/…`
 * isolation is enforced by the keys themselves AND verified server-side by
 * the /api/files route (which checks the requesting user's organisationId
 * matches the path).
 */

const SAFE_EXT = /^[a-z0-9]{1,8}$/;

function ext(filename: string, contentType: string): string {
  const fromName = filename.split(".").pop()?.toLowerCase() ?? "";
  if (SAFE_EXT.test(fromName)) return fromName;
  // Fall back from content-type
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  return map[contentType] ?? "bin";
}

export const storageKey = {
  orgDocument(orgId: string, docId: string, filename: string, contentType: string): string {
    return `org/${orgId}/documents/${docId}.${ext(filename, contentType)}`;
  },
  orgLogo(orgId: string, filename: string, contentType: string): string {
    return `org/${orgId}/branding/logo.${ext(filename, contentType)}`;
  },
  orgSignature(orgId: string, filename: string, contentType: string): string {
    return `org/${orgId}/branding/signature.${ext(filename, contentType)}`;
  },
  donationReceipt(orgId: string, donationId: string): string {
    return `org/${orgId}/receipts/${donationId}.pdf`;
  },
  donationReceiptArchive(orgId: string, donationId: string, version: number): string {
    return `org/${orgId}/receipts/archive/${donationId}-v${version}.pdf`;
  },
  donorDocument(orgId: string, docId: string, filename: string, contentType: string): string {
    return `org/${orgId}/donors/${docId}.${ext(filename, contentType)}`;
  },
  utilisationCert(orgId: string, projectId: string, certId: string): string {
    return `org/${orgId}/utilisation-certs/${projectId}-${certId}.pdf`;
  },
  volunteerCertificate(orgId: string, volunteerId: string, certId: string): string {
    return `org/${orgId}/volunteer-certs/${volunteerId}-${certId}.pdf`;
  },
  beneficiaryDocument(orgId: string, beneficiaryId: string, docId: string, filename: string, contentType: string): string {
    return `org/${orgId}/beneficiaries/${beneficiaryId}-${docId}.${ext(filename, contentType)}`;
  },
  // Phase 5 — compliance exports + 10BE certs + Form 16/16A drafts
  form10BdExport(orgId: string, filingId: string, withHeader: boolean): string {
    return `org/${orgId}/compliance/10bd/${filingId}${withHeader ? "-with-header" : ""}.csv`;
  },
  form10BdSummary(orgId: string, filingId: string): string {
    return `org/${orgId}/compliance/10bd/${filingId}-summary.pdf`;
  },
  form10BeCert(orgId: string, filingId: string, donorId: string): string {
    return `org/${orgId}/compliance/10be/${filingId}-${donorId}.pdf`;
  },
  form16(orgId: string, returnId: string, deducteeId: string): string {
    return `org/${orgId}/compliance/form16/${returnId}-${deducteeId}.pdf`;
  },
  form16a(orgId: string, returnId: string, deducteeId: string): string {
    return `org/${orgId}/compliance/form16a/${returnId}-${deducteeId}.pdf`;
  },
  itr7Export(orgId: string, filingId: string, kind: "excel" | "pdf"): string {
    return `org/${orgId}/compliance/itr7/${filingId}.${kind === "excel" ? "xlsx" : "pdf"}`;
  },
  gstrExport(orgId: string, filingId: string, kind: "json" | "excel"): string {
    return `org/${orgId}/compliance/gstr/${filingId}.${kind === "json" ? "json" : "xlsx"}`;
  },
  tdsReturnExport(orgId: string, returnId: string, kind: "rpu" | "excel"): string {
    return `org/${orgId}/compliance/tds/${returnId}.${kind === "rpu" ? "txt" : "xlsx"}`;
  },
  /**
   * Phase 6 — standard reports. Keyed by report type + report row id so the
   * same kind can be re-generated multiple times without clobbering history.
   */
  report(
    orgId: string,
    reportType: string,
    reportId: string,
    ext: "pdf" | "xlsx",
  ): string {
    return `org/${orgId}/reports/${reportType.toLowerCase()}/${reportId}.${ext}`;
  },
} as const;

/**
 * Parse a key back into its components. Used by /api/files to enforce the
 * org-scope check before streaming.
 */
export function parseStorageKey(key: string):
  | { orgId: string; kind: "documents"; docId: string }
  | { orgId: string; kind: "branding"; asset: "logo" | "signature" }
  | { orgId: string; kind: "receipts"; donationId: string; archive: boolean }
  | { orgId: string; kind: "donors"; docId: string }
  | { orgId: string; kind: "compliance"; sub: string }
  | { orgId: string; kind: "utilisation-certs"; suffix: string }
  | { orgId: string; kind: "volunteer-certs"; suffix: string }
  | { orgId: string; kind: "reports"; sub: string }
  | null {
  const parts = key.replace(/^\/+/, "").split("/");
  if (parts[0] !== "org" || !parts[1]) return null;
  const orgId = parts[1];

  if (parts[2] === "documents" && parts[3]) {
    const docId = parts[3].split(".")[0];
    return { orgId, kind: "documents", docId };
  }
  if (parts[2] === "branding" && parts[3]) {
    const name = parts[3].split(".")[0];
    if (name === "logo" || name === "signature") {
      return { orgId, kind: "branding", asset: name };
    }
  }
  if (parts[2] === "receipts" && parts[3]) {
    if (parts[3] === "archive" && parts[4]) {
      const donationId = parts[4].split("-v")[0];
      return { orgId, kind: "receipts", donationId, archive: true };
    }
    const donationId = parts[3].split(".")[0];
    return { orgId, kind: "receipts", donationId, archive: false };
  }
  if (parts[2] === "donors" && parts[3]) {
    const docId = parts[3].split(".")[0];
    return { orgId, kind: "donors", docId };
  }
  if (parts[2] === "compliance" && parts.length >= 4) {
    return { orgId, kind: "compliance", sub: parts.slice(3).join("/") };
  }
  if (parts[2] === "utilisation-certs" && parts[3]) {
    return { orgId, kind: "utilisation-certs", suffix: parts[3] };
  }
  if (parts[2] === "volunteer-certs" && parts[3]) {
    return { orgId, kind: "volunteer-certs", suffix: parts[3] };
  }
  if (parts[2] === "reports" && parts.length >= 4) {
    return { orgId, kind: "reports", sub: parts.slice(3).join("/") };
  }
  return null;
}

/** Public URL the app embeds in <img src> / receipt PDF templates. */
export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}
