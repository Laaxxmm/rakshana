import type { Metadata } from "next";
import {
  IconBuilding,
  IconFileText,
  IconReceiptTax,
  IconCash,
  IconBuildingBank,
  IconPalette,
} from "@tabler/icons-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { loadEditHistory } from "@/lib/audit/history";

import { IdentityForm } from "./IdentityForm";
import { LegalDocsPanel } from "./LegalDocsPanel";
import { TaxCompliancePanel } from "./TaxCompliancePanel";
import { FundingPanel } from "./FundingPanel";
import { BankingPanel } from "./BankingPanel";
import { BrandingPanel } from "./BrandingPanel";

export const metadata: Metadata = { title: "Organisation profile — Rakshana" };

export default async function OrganisationProfilePage() {
  const scope = await requireOrgScope();

  const [
    organisation,
    twelveA,
    eightyG,
    gst,
    fcra,
    darpan,
    csrOne,
    bankAccounts,
    legalDocs,
    identityHistory,
  ] = await Promise.all([
    prismaUnsafe.organisation.findUnique({ where: { id: scope.organisationId } }),
    prisma.twelveARegistration.findFirst(),
    prisma.eightyGRegistration.findFirst(),
    prisma.gstRegistration.findFirst(),
    prisma.fcraRegistration.findFirst(),
    prisma.darpanRegistration.findFirst(),
    prisma.csrOneRegistration.findFirst(),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    prisma.orgDocument.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    loadEditHistory("Organisation", scope.organisationId),
  ]);

  if (!organisation) {
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-border bg-surface p-8">
        <h1 className="font-display text-2xl">Organisation profile</h1>
        <p className="mt-2 text-sm text-ink-muted">
          No organisation has been set up yet. Run <code>npm run db:seed</code>.
        </p>
      </div>
    );
  }

  const canEdit = scope.role === "OWNER";
  const canEditBanking = canEdit || scope.role === "ADMIN";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Settings · Organisation
        </p>
        <h1
          className="mt-1 font-display text-4xl text-ink"
          style={{ fontVariationSettings: "'opsz' 32" }}
        >
          {organisation.name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {organisation.charitablePurpose ?? "Charitable trust"} ·{" "}
          {organisation.subCategory ?? "—"}
        </p>
      </header>

      <Tabs defaultValue="identity">
        <TabsList>
          <TabsTrigger value="identity">
            <IconBuilding size={14} />
            Identity
          </TabsTrigger>
          <TabsTrigger value="legal">
            <IconFileText size={14} />
            Legal docs
          </TabsTrigger>
          <TabsTrigger value="tax">
            <IconReceiptTax size={14} />
            Tax compliance
          </TabsTrigger>
          <TabsTrigger value="funding">
            <IconCash size={14} />
            Funding
          </TabsTrigger>
          <TabsTrigger value="banking">
            <IconBuildingBank size={14} />
            Banking
          </TabsTrigger>
          <TabsTrigger value="branding">
            <IconPalette size={14} />
            Branding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="mt-6 space-y-4">
          <IdentityForm
            canEdit={canEdit}
            defaults={{
              name: organisation.name,
              legalName: organisation.legalName ?? "",
              charitablePurpose: organisation.charitablePurpose ?? "",
              subCategory: organisation.subCategory ?? "",
              phone: organisation.phone ?? "",
              email: organisation.email ?? "",
              website: organisation.website ?? "",
              addressLine1: organisation.addressLine1 ?? "",
              addressLine2: organisation.addressLine2 ?? "",
              city: organisation.city ?? "",
              district: organisation.district ?? "",
              state: organisation.state ?? "",
              pincode: organisation.pincode ?? "",
              country: organisation.country ?? "India",
              registrationType: organisation.registrationType,
              registrationNumber: organisation.registrationNumber ?? "",
              registrationDate: organisation.registrationDate
                ? organisation.registrationDate.toISOString().slice(0, 10)
                : "",
              pan: organisation.pan ?? "",
              tan: organisation.tan ?? "",
              cin: organisation.cin ?? "",
              authorisedSignatoryName: organisation.authorisedSignatoryName ?? "",
              authorisedSignatoryDesignation: organisation.authorisedSignatoryDesignation ?? "",
              fyStartMonth: organisation.fyStartMonth,
              fyStartDay: organisation.fyStartDay,
            }}
            history={identityHistory}
          />
        </TabsContent>

        <TabsContent value="legal" className="mt-6 space-y-4">
          <LegalDocsPanel canEdit={canEdit} docs={legalDocs.map(plainDoc)} />
        </TabsContent>

        <TabsContent value="tax" className="mt-6 space-y-4">
          <TaxCompliancePanel
            canEdit={canEdit}
            stateCode={organisation.stateCode ?? null}
            twelveA={
              twelveA
                ? {
                    number: twelveA.number,
                    registrationDate: twelveA.registrationDate.toISOString().slice(0, 10),
                    validityEndDate: twelveA.validityEndDate?.toISOString().slice(0, 10) ?? "",
                    isProvisional: twelveA.isProvisional,
                    remarks: twelveA.remarks ?? "",
                  }
                : null
            }
            eightyG={
              eightyG
                ? {
                    number: eightyG.number,
                    approvalDate: eightyG.approvalDate.toISOString().slice(0, 10),
                    validityEndDate: eightyG.validityEndDate?.toISOString().slice(0, 10) ?? "",
                    isProvisional: eightyG.isProvisional,
                    remarks: eightyG.remarks ?? "",
                  }
                : null
            }
            gst={
              gst
                ? {
                    gstin: gst.gstin,
                    registrationDate: gst.registrationDate.toISOString().slice(0, 10),
                    remarks: gst.remarks ?? "",
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="funding" className="mt-6 space-y-4">
          <FundingPanel
            canEdit={canEdit}
            hasFcraOnlyBank={bankAccounts.some((b) => b.purpose === "FCRA_ONLY")}
            fcra={
              fcra
                ? {
                    number: fcra.number,
                    registrationDate: fcra.registrationDate.toISOString().slice(0, 10),
                    validityEndDate: fcra.validityEndDate?.toISOString().slice(0, 10) ?? "",
                    fcraBankName: fcra.fcraBankName ?? "",
                    fcraBankAccountNumber: fcra.fcraBankAccountNumber ?? "",
                    fcraBankBranch: fcra.fcraBankBranch ?? "",
                    fcraBankIfsc: fcra.fcraBankIfsc ?? "",
                    remarks: fcra.remarks ?? "",
                  }
                : null
            }
            darpan={
              darpan
                ? {
                    darpanId: darpan.darpanId,
                    registrationDate: darpan.registrationDate?.toISOString().slice(0, 10) ?? "",
                  }
                : null
            }
            csrOne={
              csrOne
                ? {
                    csrOneRef: csrOne.csrOneRef,
                    registrationDate: csrOne.registrationDate?.toISOString().slice(0, 10) ?? "",
                  }
                : null
            }
          />
        </TabsContent>

        <TabsContent value="banking" className="mt-6 space-y-4">
          <BankingPanel
            canEdit={canEditBanking}
            accounts={bankAccounts.map((a) => ({
              id: a.id,
              bankName: a.bankName,
              branch: a.branch ?? "",
              accountNumber: a.accountNumber,
              accountHolder: a.accountHolder ?? "",
              ifsc: a.ifsc ?? "",
              accountType: a.accountType,
              purpose: a.purpose,
              openingBalance: a.openingBalance.toString(),
              isPrimary: a.isPrimary,
            }))}
            fcraActive={!!fcra}
          />
        </TabsContent>

        <TabsContent value="branding" className="mt-6 space-y-4">
          <BrandingPanel
            canEdit={canEdit}
            logoUrl={organisation.logoUrl ?? null}
            signatureUrl={organisation.signatureImageUrl ?? null}
            headerText={organisation.receiptHeaderText ?? ""}
            footerText={organisation.receiptFooterText ?? ""}
            orgName={organisation.name}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function plainDoc(d: {
  id: string;
  category: string;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  issueDate: Date | null;
  expiryDate: Date | null;
}) {
  return {
    id: d.id,
    category: d.category,
    title: d.title,
    fileUrl: d.fileUrl,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    issueDate: d.issueDate?.toISOString().slice(0, 10) ?? null,
    expiryDate: d.expiryDate?.toISOString().slice(0, 10) ?? null,
  };
}
