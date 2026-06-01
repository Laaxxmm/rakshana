-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('TRUST', 'SOCIETY', 'SECTION_8_COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'PROJECT_MANAGER', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrgDocumentCategory" AS ENUM ('REGISTRATION_CERT', 'TRUST_DEED', 'PAN', 'TWELVE_A', 'EIGHTY_G', 'FCRA', 'DARPAN', 'CSR_ONE', 'GST', 'AUTHORISED_SIGNATORY', 'OTHER');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT', 'OD', 'CC');

-- CreateEnum
CREATE TYPE "BankAccountPurpose" AS ENUM ('GENERAL', 'FCRA_ONLY', 'CORPUS', 'PROJECT_SPECIFIC');

-- CreateEnum
CREATE TYPE "DonorType" AS ENUM ('INDIVIDUAL', 'CORPORATE', 'NRI', 'ANONYMOUS', 'TRUST', 'HUF', 'GOVERNMENT', 'FOREIGN_SOURCE');

-- CreateEnum
CREATE TYPE "DonorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DonorDocumentCategory" AS ENUM ('PAN_CARD', 'AADHAAR', 'ID_PROOF', 'CSR_FORM', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SMS', 'CALL', 'IN_PERSON', 'LETTER');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "DonationMode" AS ENUM ('CASH', 'CHEQUE', 'DD', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CARD', 'ONLINE_GATEWAY', 'IN_KIND', 'OTHER');

-- CreateEnum
CREATE TYPE "InKindValuationMethod" AS ENUM ('FAIR_MARKET_VALUE', 'COST', 'APPRAISED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "DonationPurpose" AS ENUM ('GENERAL', 'CORPUS', 'PROJECT_SPECIFIC', 'CSR', 'RELIEF', 'EARMARKED_GRANT');

-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('RECEIVED', 'PENDING_REALISATION', 'REALISED', 'BOUNCED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Form10BDDonationType" AS ENUM ('CORPUS', 'SPECIFIC_GRANT', 'OTHERS', 'FOREIGN_SOURCE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CHEQUE', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ApprovalScope" AS ENUM ('EXPENSE', 'GRANT', 'RECURRING');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('ACTIVE', 'EXITED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DisbursementType" AS ENUM ('CASH', 'KIND', 'SERVICE', 'SCHOLARSHIP', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "VolunteerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ALUMNI');

-- CreateEnum
CREATE TYPE "Form10BDStatus" AS ENUM ('DRAFT', 'VALIDATED', 'EXPORTED', 'FILED', 'REVISED');

-- CreateEnum
CREATE TYPE "ItFilingType" AS ENUM ('ITR7', 'FORM_10', 'FORM_10B', 'FORM_10BB', 'FORM_9A');

-- CreateEnum
CREATE TYPE "ItFilingStatus" AS ENUM ('PENDING', 'PREPARED', 'FILED', 'REVISED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "GstInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GstFilingType" AS ENUM ('GSTR1', 'GSTR3B', 'GSTR9', 'GSTR9A');

-- CreateEnum
CREATE TYPE "GstFilingStatus" AS ENUM ('PENDING', 'PREPARED', 'FILED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "TdsReturnType" AS ENUM ('FORM_26Q', 'FORM_24Q', 'FORM_27Q', 'FORM_27EQ');

-- CreateEnum
CREATE TYPE "TdsReturnStatus" AS ENUM ('PENDING', 'PREPARED', 'FILED', 'REVISED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ComplianceCategory" AS ENUM ('GST', 'TDS', 'IT', 'FCRA', 'TWELVE_A', 'EIGHTY_G', 'DARPAN', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('UPCOMING', 'DUE', 'FILED', 'OVERDUE', 'WAIVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'SMS');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "charitablePurpose" TEXT,
    "subCategory" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pincode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "registrationType" "RegistrationType" NOT NULL DEFAULT 'TRUST',
    "registrationNumber" TEXT,
    "registrationDate" TIMESTAMP(3),
    "pan" TEXT,
    "tan" TEXT,
    "cin" TEXT,
    "authorisedSignatoryName" TEXT,
    "authorisedSignatoryDesignation" TEXT,
    "caFirmName" TEXT,
    "caPartnerName" TEXT,
    "caEmail" TEXT,
    "caPhone" TEXT,
    "logoUrl" TEXT,
    "signatureImageUrl" TEXT,
    "receiptHeaderText" TEXT,
    "receiptFooterText" TEXT,
    "fyStartMonth" INTEGER NOT NULL DEFAULT 4,
    "fyStartDay" INTEGER NOT NULL DEFAULT 1,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwelveARegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3) NOT NULL,
    "validityEndDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwelveARegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EightyGRegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "approvalDate" TIMESTAMP(3) NOT NULL,
    "validityEndDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EightyGRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstRegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3) NOT NULL,
    "documentUrl" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FcraRegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3) NOT NULL,
    "validityEndDate" TIMESTAMP(3),
    "fcraBankName" TEXT,
    "fcraBankAccountNumber" TEXT,
    "fcraBankBranch" TEXT,
    "fcraBankIfsc" TEXT,
    "documentUrl" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FcraRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DarpanRegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "darpanId" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DarpanRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsrOneRegistration" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "csrOneRef" TEXT NOT NULL,
    "registrationDate" TIMESTAMP(3),
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsrOneRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "category" "OrgDocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "remarks" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branch" TEXT,
    "accountNumber" TEXT NOT NULL,
    "accountHolder" TEXT,
    "ifsc" TEXT,
    "accountType" "BankAccountType" NOT NULL DEFAULT 'SAVINGS',
    "purpose" "BankAccountPurpose" NOT NULL DEFAULT 'GENERAL',
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "customRoleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Donor" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "donorType" "DonorType" NOT NULL,
    "name" TEXT NOT NULL,
    "pan" TEXT,
    "aadhaarLast4" TEXT,
    "isAnonymousBucket" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pincode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "is80GEligible" BOOLEAN NOT NULL DEFAULT true,
    "isFcraEligible" BOOLEAN NOT NULL DEFAULT false,
    "isCsrDonor" BOOLEAN NOT NULL DEFAULT false,
    "csrCompanyCin" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "internalNotes" TEXT,
    "totalDonatedLifetime" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastDonationDate" TIMESTAMP(3),
    "status" "DonorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Donor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorDocument" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "category" "DonorDocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Communication" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "donorId" TEXT,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND',
    "subject" TEXT,
    "body" TEXT,
    "attachmentUrl" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSeries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "separator" TEXT NOT NULL DEFAULT '/',
    "width" INTEGER NOT NULL DEFAULT 4,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "isFcraOnly" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "receiptSeriesId" TEXT,
    "donationDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "mode" "DonationMode" NOT NULL,
    "bankAccountId" TEXT,
    "paymentRef" TEXT,
    "paymentDate" TIMESTAMP(3),
    "paymentRealisedDate" TIMESTAMP(3),
    "isInKind" BOOLEAN NOT NULL DEFAULT false,
    "inKindDescription" TEXT,
    "inKindValuationMethod" "InKindValuationMethod",
    "purpose" "DonationPurpose" NOT NULL DEFAULT 'GENERAL',
    "projectId" TEXT,
    "is80GEligible" BOOLEAN NOT NULL DEFAULT true,
    "isCsr" BOOLEAN NOT NULL DEFAULT false,
    "csrCompanyCin" TEXT,
    "isFcra" BOOLEAN NOT NULL DEFAULT false,
    "receiptUrl" TEXT,
    "receiptGeneratedAt" TIMESTAMP(3),
    "amountInWords" TEXT,
    "isReportedIn10BD" BOOLEAN NOT NULL DEFAULT false,
    "form10BdFilingId" TEXT,
    "donationTypeFor10BD" "Form10BDDonationType",
    "identificationTypeFor10BD" TEXT,
    "status" "DonationStatus" NOT NULL DEFAULT 'RECEIVED',
    "cancellationReason" TEXT,
    "remarks" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pan" TEXT,
    "gstin" TEXT,
    "defaultTdsSection" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT,
    "categoryId" TEXT,
    "projectId" TEXT,
    "grossAmount" DECIMAL(18,2) NOT NULL,
    "tdsAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsSection" TEXT,
    "tdsRate" DECIMAL(5,2),
    "netPayable" DECIMAL(18,2) NOT NULL,
    "gstApplicable" BOOLEAN NOT NULL DEFAULT false,
    "cgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isItcEligible" BOOLEAN NOT NULL DEFAULT false,
    "mode" "PaymentMode" NOT NULL,
    "bankAccountId" TEXT,
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "billUrl" TEXT,
    "description" TEXT,
    "isPettyCash" BOOLEAN NOT NULL DEFAULT false,
    "pettyCashFloatId" TEXT,
    "recurringTemplateId" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseApproval" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "decision" "ApprovalDecision" NOT NULL,
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "scope" "ApprovalScope" NOT NULL DEFAULT 'EXPENSE',
    "minAmount" DECIMAL(18,2) NOT NULL,
    "maxAmount" DECIMAL(18,2),
    "requiredRole" "OrgRole" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashFloat" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "custodianId" TEXT,
    "floatAmount" DECIMAL(18,2) NOT NULL,
    "currentBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashFloat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashTopUp" (
    "id" TEXT NOT NULL,
    "floatId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "topUpDate" TIMESTAMP(3) NOT NULL,
    "bankAccountId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendorId" TEXT,
    "categoryId" TEXT,
    "projectId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "totalBudget" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "managerId" TEXT,
    "isCsr" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgetHead" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budgetedAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBudgetHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrantAllocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "donorId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "receivedOn" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilisationCertificate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "donorId" TEXT,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "amountReceived" DECIMAL(18,2) NOT NULL,
    "amountUtilised" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "fileUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,

    CONSTRAINT "UtilisationCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beneficiary" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "gender" "Gender",
    "category" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "photoUrl" TEXT,
    "idProofUrl" TEXT,
    "internalNotes" TEXT,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeneficiaryEnrolment" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "enrolledOn" TIMESTAMP(3) NOT NULL,
    "exitedOn" TIMESTAMP(3),
    "remarks" TEXT,

    CONSTRAINT "BeneficiaryEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeneficiaryDisbursement" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "disbursementDate" TIMESTAMP(3) NOT NULL,
    "type" "DisbursementType" NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "expenseId" TEXT,
    "ackUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeneficiaryDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactRecord" (
    "id" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Volunteer" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" TEXT,
    "joinedOn" TIMESTAMP(3),
    "status" "VolunteerStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Volunteer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerActivity" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "requiredVolunteers" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerAssignment" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "hours" DECIMAL(10,2),
    "remarks" TEXT,

    CONSTRAINT "VolunteerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolunteerCertificate" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "totalHours" DECIMAL(10,2) NOT NULL,
    "fileUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolunteerCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form10BDFiling" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preparedById" TEXT,
    "filingStatus" "Form10BDStatus" NOT NULL DEFAULT 'DRAFT',
    "filedAt" TIMESTAMP(3),
    "arnNumber" TEXT,
    "acknowledgementUrl" TEXT,
    "csvExportUrl" TEXT,
    "totalDonations" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDonors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Form10BDFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form10BECertificate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "aggregateAmount" DECIMAL(18,2) NOT NULL,
    "donationTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileUrl" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailedAt" TIMESTAMP(3),
    "whatsappedAt" TIMESTAMP(3),

    CONSTRAINT "Form10BECertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItFiling" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "filingType" "ItFilingType" NOT NULL,
    "dueDate" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "ackNumber" TEXT,
    "fileUrl" TEXT,
    "status" "ItFilingStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialYearSummary" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "totalReceipts" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "corpusDonations" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fcraDonations" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "anonymousDonations" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalApplication" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revenueApplication" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "capitalApplication" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "accumulatedUnderSec11_2" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "applicationPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialYearSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstInvoiceSeries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstInvoiceSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstInvoice" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerGstin" TEXT,
    "buyerStateCode" TEXT,
    "placeOfSupply" TEXT,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "isExempted" BOOLEAN NOT NULL DEFAULT false,
    "exemptionRef" TEXT,
    "hsnSac" TEXT,
    "taxableValue" DECIMAL(18,2) NOT NULL,
    "cgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "status" "GstInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "fileUrl" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GstInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstFiling" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "filingType" "GstFilingType" NOT NULL,
    "period" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "arnNumber" TEXT,
    "exportUrl" TEXT,
    "status" "GstFilingStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsEntry" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "expenseId" TEXT,
    "deducteeName" TEXT NOT NULL,
    "deducteePan" TEXT,
    "section" TEXT NOT NULL,
    "amountPaid" DECIMAL(18,2) NOT NULL,
    "tdsRate" DECIMAL(5,2) NOT NULL,
    "tdsAmount" DECIMAL(18,2) NOT NULL,
    "deductionDate" TIMESTAMP(3) NOT NULL,
    "challanId" TEXT,
    "quarter" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "ldcCertificateId" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsChallan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "challanNumber" TEXT NOT NULL,
    "bsrCode" TEXT NOT NULL,
    "challanDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "section" TEXT,
    "fileUrl" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsReturn" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "formType" "TdsReturnType" NOT NULL,
    "financialYear" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "ackNumber" TEXT,
    "fileUrl" TEXT,
    "status" "TdsReturnStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LdcCertificate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "deducteeName" TEXT NOT NULL,
    "deducteePan" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "certNumber" TEXT NOT NULL,
    "lowerRate" DECIMAL(5,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "fileUrl" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LdcCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "category" "ComplianceCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "responsibleUserId" TEXT,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'UPCOMING',
    "completedAt" TIMESTAMP(3),
    "referenceUrl" TEXT,
    "referenceModel" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organisation_status_idx" ON "Organisation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TwelveARegistration_organisationId_key" ON "TwelveARegistration"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "EightyGRegistration_organisationId_key" ON "EightyGRegistration"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "GstRegistration_organisationId_key" ON "GstRegistration"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "FcraRegistration_organisationId_key" ON "FcraRegistration"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "DarpanRegistration_organisationId_key" ON "DarpanRegistration"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CsrOneRegistration_organisationId_key" ON "CsrOneRegistration"("organisationId");

-- CreateIndex
CREATE INDEX "OrgDocument_organisationId_category_idx" ON "OrgDocument"("organisationId", "category");

-- CreateIndex
CREATE INDEX "OrgDocument_expiryDate_idx" ON "OrgDocument"("expiryDate");

-- CreateIndex
CREATE INDEX "BankAccount_organisationId_isActive_idx" ON "BankAccount"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_organisationId_accountNumber_key" ON "BankAccount"("organisationId", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "Membership_organisationId_role_idx" ON "Membership"("organisationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organisationId_key" ON "Membership"("userId", "organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organisationId_name_key" ON "Role"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "Donor_organisationId_donorType_idx" ON "Donor"("organisationId", "donorType");

-- CreateIndex
CREATE INDEX "Donor_organisationId_name_idx" ON "Donor"("organisationId", "name");

-- CreateIndex
CREATE INDEX "Donor_organisationId_isAnonymousBucket_idx" ON "Donor"("organisationId", "isAnonymousBucket");

-- CreateIndex
CREATE UNIQUE INDEX "donor_org_pan_unique" ON "Donor"("organisationId", "pan");

-- CreateIndex
CREATE INDEX "Communication_organisationId_donorId_idx" ON "Communication"("organisationId", "donorId");

-- CreateIndex
CREATE INDEX "Communication_organisationId_occurredAt_idx" ON "Communication"("organisationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptSeries_organisationId_name_financialYear_key" ON "ReceiptSeries"("organisationId", "name", "financialYear");

-- CreateIndex
CREATE INDEX "Donation_organisationId_donationDate_idx" ON "Donation"("organisationId", "donationDate");

-- CreateIndex
CREATE INDEX "Donation_organisationId_donorId_idx" ON "Donation"("organisationId", "donorId");

-- CreateIndex
CREATE INDEX "Donation_organisationId_projectId_idx" ON "Donation"("organisationId", "projectId");

-- CreateIndex
CREATE INDEX "Donation_organisationId_status_idx" ON "Donation"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Donation_organisationId_isFcra_idx" ON "Donation"("organisationId", "isFcra");

-- CreateIndex
CREATE INDEX "Donation_organisationId_isCsr_idx" ON "Donation"("organisationId", "isCsr");

-- CreateIndex
CREATE INDEX "Donation_organisationId_donationDate_status_idx" ON "Donation"("organisationId", "donationDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_organisationId_receiptNumber_key" ON "Donation"("organisationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "Vendor_organisationId_name_idx" ON "Vendor"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_organisationId_name_key" ON "ExpenseCategory"("organisationId", "name");

-- CreateIndex
CREATE INDEX "Expense_organisationId_expenseDate_idx" ON "Expense"("organisationId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_organisationId_vendorId_idx" ON "Expense"("organisationId", "vendorId");

-- CreateIndex
CREATE INDEX "Expense_organisationId_projectId_idx" ON "Expense"("organisationId", "projectId");

-- CreateIndex
CREATE INDEX "Expense_organisationId_status_idx" ON "Expense"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organisationId_voucherNumber_key" ON "Expense"("organisationId", "voucherNumber");

-- CreateIndex
CREATE INDEX "ExpenseApproval_approverId_decision_idx" ON "ExpenseApproval"("approverId", "decision");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_organisationId_scope_idx" ON "ApprovalPolicy"("organisationId", "scope");

-- CreateIndex
CREATE INDEX "Project_organisationId_status_idx" ON "Project"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organisationId_code_key" ON "Project"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudgetHead_projectId_name_key" ON "ProjectBudgetHead"("projectId", "name");

-- CreateIndex
CREATE INDEX "Beneficiary_organisationId_name_idx" ON "Beneficiary"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Beneficiary_organisationId_code_key" ON "Beneficiary"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BeneficiaryEnrolment_beneficiaryId_projectId_key" ON "BeneficiaryEnrolment"("beneficiaryId", "projectId");

-- CreateIndex
CREATE INDEX "Volunteer_organisationId_name_idx" ON "Volunteer"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerAssignment_volunteerId_activityId_key" ON "VolunteerAssignment"("volunteerId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "Form10BDFiling_organisationId_financialYear_key" ON "Form10BDFiling"("organisationId", "financialYear");

-- CreateIndex
CREATE INDEX "Form10BECertificate_organisationId_idx" ON "Form10BECertificate"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Form10BECertificate_filingId_donorId_key" ON "Form10BECertificate"("filingId", "donorId");

-- CreateIndex
CREATE UNIQUE INDEX "ItFiling_organisationId_financialYear_filingType_key" ON "ItFiling"("organisationId", "financialYear", "filingType");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYearSummary_organisationId_financialYear_key" ON "FinancialYearSummary"("organisationId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "GstInvoiceSeries_organisationId_name_financialYear_key" ON "GstInvoiceSeries"("organisationId", "name", "financialYear");

-- CreateIndex
CREATE INDEX "GstInvoice_organisationId_invoiceDate_idx" ON "GstInvoice"("organisationId", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "GstInvoice_organisationId_invoiceNumber_key" ON "GstInvoice"("organisationId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GstFiling_organisationId_filingType_period_key" ON "GstFiling"("organisationId", "filingType", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TdsEntry_expenseId_key" ON "TdsEntry"("expenseId");

-- CreateIndex
CREATE INDEX "TdsEntry_organisationId_financialYear_quarter_idx" ON "TdsEntry"("organisationId", "financialYear", "quarter");

-- CreateIndex
CREATE INDEX "TdsEntry_organisationId_section_idx" ON "TdsEntry"("organisationId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "TdsChallan_organisationId_challanNumber_key" ON "TdsChallan"("organisationId", "challanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TdsReturn_organisationId_formType_financialYear_quarter_key" ON "TdsReturn"("organisationId", "formType", "financialYear", "quarter");

-- CreateIndex
CREATE INDEX "LdcCertificate_organisationId_deducteePan_idx" ON "LdcCertificate"("organisationId", "deducteePan");

-- CreateIndex
CREATE INDEX "ComplianceItem_organisationId_dueDate_idx" ON "ComplianceItem"("organisationId", "dueDate");

-- CreateIndex
CREATE INDEX "ComplianceItem_organisationId_status_idx" ON "ComplianceItem"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Notification_organisationId_userId_isRead_idx" ON "Notification"("organisationId", "userId", "isRead");

-- CreateIndex
CREATE INDEX "AuditLog_organisationId_entityType_entityId_idx" ON "AuditLog"("organisationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organisationId_userId_createdAt_idx" ON "AuditLog"("organisationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organisationId_createdAt_idx" ON "AuditLog"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "TwelveARegistration" ADD CONSTRAINT "TwelveARegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EightyGRegistration" ADD CONSTRAINT "EightyGRegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstRegistration" ADD CONSTRAINT "GstRegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FcraRegistration" ADD CONSTRAINT "FcraRegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DarpanRegistration" ADD CONSTRAINT "DarpanRegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsrOneRegistration" ADD CONSTRAINT "CsrOneRegistration_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDocument" ADD CONSTRAINT "OrgDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDocument" ADD CONSTRAINT "OrgDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donor" ADD CONSTRAINT "Donor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorDocument" ADD CONSTRAINT "DonorDocument_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Communication" ADD CONSTRAINT "Communication_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptSeries" ADD CONSTRAINT "ReceiptSeries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_receiptSeriesId_fkey" FOREIGN KEY ("receiptSeriesId") REFERENCES "ReceiptSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_form10BdFilingId_fkey" FOREIGN KEY ("form10BdFilingId") REFERENCES "Form10BDFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_pettyCashFloatId_fkey" FOREIGN KEY ("pettyCashFloatId") REFERENCES "PettyCashFloat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseApproval" ADD CONSTRAINT "ExpenseApproval_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseApproval" ADD CONSTRAINT "ExpenseApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashFloat" ADD CONSTRAINT "PettyCashFloat_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashFloat" ADD CONSTRAINT "PettyCashFloat_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTopUp" ADD CONSTRAINT "PettyCashTopUp_floatId_fkey" FOREIGN KEY ("floatId") REFERENCES "PettyCashFloat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetHead" ADD CONSTRAINT "ProjectBudgetHead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantAllocation" ADD CONSTRAINT "GrantAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisationCertificate" ADD CONSTRAINT "UtilisationCertificate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beneficiary" ADD CONSTRAINT "Beneficiary_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryEnrolment" ADD CONSTRAINT "BeneficiaryEnrolment_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryEnrolment" ADD CONSTRAINT "BeneficiaryEnrolment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryDisbursement" ADD CONSTRAINT "BeneficiaryDisbursement_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactRecord" ADD CONSTRAINT "ImpactRecord_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Volunteer" ADD CONSTRAINT "Volunteer_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerActivity" ADD CONSTRAINT "VolunteerActivity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAssignment" ADD CONSTRAINT "VolunteerAssignment_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "Volunteer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerAssignment" ADD CONSTRAINT "VolunteerAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "VolunteerActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerCertificate" ADD CONSTRAINT "VolunteerCertificate_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "Volunteer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form10BDFiling" ADD CONSTRAINT "Form10BDFiling_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form10BECertificate" ADD CONSTRAINT "Form10BECertificate_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "Form10BDFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Form10BECertificate" ADD CONSTRAINT "Form10BECertificate_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItFiling" ADD CONSTRAINT "ItFiling_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstInvoiceSeries" ADD CONSTRAINT "GstInvoiceSeries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstInvoice" ADD CONSTRAINT "GstInvoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstFiling" ADD CONSTRAINT "GstFiling_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsEntry" ADD CONSTRAINT "TdsEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsEntry" ADD CONSTRAINT "TdsEntry_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsEntry" ADD CONSTRAINT "TdsEntry_challanId_fkey" FOREIGN KEY ("challanId") REFERENCES "TdsChallan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsEntry" ADD CONSTRAINT "TdsEntry_ldcCertificateId_fkey" FOREIGN KEY ("ldcCertificateId") REFERENCES "LdcCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsReturn" ADD CONSTRAINT "TdsReturn_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LdcCertificate" ADD CONSTRAINT "LdcCertificate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceItem" ADD CONSTRAINT "ComplianceItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
