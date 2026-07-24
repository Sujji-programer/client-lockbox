import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessibleDeliverables, parseInvoiceWorkflowMetadata } from "@/lib/invoice-workflow";

export const runtime = "nodejs";

export type InvoiceAttachment = {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  uploadedAt: string;
  deliverableType?: "DRAFT_PREVIEW" | "FINAL_VAULT";
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const admin = createAdminClient();

  const { data: invoice, error } = await admin
    .from("invoices")
    .select("id, status, file_path")
    .eq("id", id)
    .maybeSingle();

  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  if (invoice.status !== "PAID") {
    return NextResponse.json({ error: "Invoice is not paid yet." }, { status: 403 });
  }

  const workflowMetadata = parseInvoiceWorkflowMetadata(invoice.file_path as string | null | undefined);
  const attachments = getAccessibleDeliverables(workflowMetadata);
  const attachment = attachments.find((item) => item.id === fileId);

  if (!attachment) {
    return NextResponse.json({ error: "Requested file was not found for this invoice." }, { status: 404 });
  }

  const { data, error: signedUrlError } = await admin.storage
    .from("deliverables")
    .createSignedUrl(attachment.path, 60 * 60);

  if (signedUrlError || !data?.signedUrl) {
    return NextResponse.json({ error: "Could not generate a secure download link." }, { status: 500 });
  }

  return NextResponse.json({
    url: data.signedUrl,
    name: attachment.name,
    contentType: attachment.type,
  });
}
