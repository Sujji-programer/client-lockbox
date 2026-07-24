export type DeliverableType = "DRAFT_PREVIEW" | "FINAL_VAULT";

export type RevisionComment = {
  id: string;
  invoiceId: string;
  senderRole: "FREELANCER" | "CLIENT";
  message: string;
  timestamp: string;
};

export type WorkflowAttachment = {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  uploadedAt: string;
  deliverableType: DeliverableType;
  url?: string | null;
  isExternal?: boolean;
};

export type InvoiceWorkflowMetadata = {
  attachments?: WorkflowAttachment[];
  drafts?: WorkflowAttachment[];
  finals?: WorkflowAttachment[];
  comments?: RevisionComment[];
  draftApproved?: boolean;
  workflowState?: "DRAFT_REVIEW" | "FINAL_VAULT_READY" | "PAID";
  lastUpdatedAt?: string;
};

export function parseInvoiceWorkflowMetadata(raw: string | null | undefined): InvoiceWorkflowMetadata {
  if (!raw) {
    return {
      drafts: [],
      finals: [],
      comments: [],
      draftApproved: false,
      workflowState: "DRAFT_REVIEW",
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const workflow = parsed as InvoiceWorkflowMetadata;
      return {
        attachments: Array.isArray(workflow.attachments) ? workflow.attachments : [],
        drafts: Array.isArray(workflow.drafts) ? workflow.drafts : [],
        finals: Array.isArray(workflow.finals) ? workflow.finals : [],
        comments: Array.isArray(workflow.comments) ? workflow.comments : [],
        draftApproved: workflow.draftApproved === true,
        workflowState: workflow.workflowState ?? (workflow.draftApproved ? "FINAL_VAULT_READY" : "DRAFT_REVIEW"),
        lastUpdatedAt: workflow.lastUpdatedAt,
      };
    }
  } catch {
    // Fall back to a single legacy attachment entry.
  }

  return {
    drafts: [],
    finals: [],
    comments: [],
    draftApproved: false,
    workflowState: "DRAFT_REVIEW",
    attachments: [
      {
        id: "legacy",
        name: raw.split("/").pop() ?? "deliverable",
        path: raw,
        size: 0,
        type: "application/octet-stream",
        uploadedAt: "",
        deliverableType: "FINAL_VAULT",
      },
    ],
  };
}

export function getAccessibleDeliverables(meta: InvoiceWorkflowMetadata): WorkflowAttachment[] {
  const finals = Array.isArray(meta.finals) ? meta.finals : [];
  if (finals.length > 0) return finals;
  return Array.isArray(meta.attachments) ? meta.attachments : [];
}

export function getDraftPreviewDeliverables(meta: InvoiceWorkflowMetadata): WorkflowAttachment[] {
  return Array.isArray(meta.drafts) ? meta.drafts : [];
}

export function serializeWorkflowMetadata(meta: InvoiceWorkflowMetadata): string {
  return JSON.stringify(meta);
}

export function createComment(invoiceId: string, senderRole: RevisionComment["senderRole"], message: string): RevisionComment {
  return {
    id: `${invoiceId}-${Date.now()}`,
    invoiceId,
    senderRole,
    message,
    timestamp: new Date().toISOString(),
  };
}
