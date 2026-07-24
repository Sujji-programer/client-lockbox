import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createComment, serializeWorkflowMetadata, parseInvoiceWorkflowMetadata } from "@/lib/invoice-workflow";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const payload = await request.json();
  const admin = createAdminClient();

  const { data: invoice, error } = await admin
    .from("invoices")
    .select("id, file_path")
    .eq("id", id)
    .maybeSingle();

  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const metadata = parseInvoiceWorkflowMetadata(invoice.file_path as string | null | undefined);
  const action = payload?.action as string | undefined;
  const senderRole = (payload?.senderRole as "FREELANCER" | "CLIENT" | undefined) ?? "CLIENT";

  if (action === "comment") {
    const message = String(payload?.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ error: "Please enter a comment." }, { status: 400 });
    }
    const comment = createComment(id, senderRole, message);
    metadata.comments = [...(metadata.comments ?? []), comment];
    metadata.lastUpdatedAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("invoices")
      .update({ file_path: serializeWorkflowMetadata(metadata) })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to save feedback." }, { status: 500 });
    }

    return NextResponse.json({ comment });
  }

  if (action === "approve-draft") {
    metadata.draftApproved = true;
    metadata.workflowState = "FINAL_VAULT_READY";
    metadata.lastUpdatedAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("invoices")
      .update({ file_path: serializeWorkflowMetadata(metadata) })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to approve draft." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, workflowState: metadata.workflowState, draftApproved: metadata.draftApproved });
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
