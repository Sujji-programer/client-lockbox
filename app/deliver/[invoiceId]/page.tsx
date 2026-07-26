/**
 * /deliver/[invoiceId] — Public paywall delivery page.
 *
 * In production this server component would query the database for the
 * real invoice and pass live props to VideoReviewPlayer. For now it
 * renders a fully-functional self-contained preview using mock data so
 * the component can be reviewed without a database connection.
 */
import { VideoReviewPlayer } from "@/components/deliver/video-review-player";

export const dynamic = "force-dynamic";

type DeliverPageProps = {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ paid?: string }>;
};

export default async function DeliverPage({ params, searchParams }: DeliverPageProps) {
  const { invoiceId } = await params;
  const { paid } = await searchParams;

  // Mock invoice data — replace with a real DB query in production.
  const mockInvoice = {
    invoiceId,
    clientName: "Priya Sharma",
    projectTitle: "Brand Reel – Q3 Launch Campaign",
    amount: 566.74,
    currency: "USD",
    // Use a public domain test video so the player renders in preview mode.
    videoSrc: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    paymentStatus: (paid === "1" ? "paid" : "unpaid") as "unpaid" | "paid",
    isEditor: false,
  };

  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      {/* Subtle ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Delivery Portal
            </p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">
              {mockInvoice.projectTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            CiteFlow · Secure Delivery
          </div>
        </div>

        {/* Client name / project meta */}
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            Prepared for{" "}
            <span className="font-semibold text-foreground">{mockInvoice.clientName}</span>
          </span>
          <span className="h-px w-4 bg-border" />
          <span>
            Invoice{" "}
            <span className="font-mono text-foreground/70">{invoiceId.slice(0, 8)}&hellip;</span>
          </span>
        </div>

        <VideoReviewPlayer
          {...mockInvoice}
          isEditor={false}
        />

        {/* Editor view toggle — demo only */}
        <div className="mt-6 rounded-xl border border-dashed border-border bg-card/40 px-4 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Demo Controls (not shown in production)
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/deliver/${invoiceId}`}
              className="rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              View as Client (Unpaid)
            </a>
            <a
              href={`/deliver/${invoiceId}?paid=1`}
              className="rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20"
            >
              View as Client (Paid / Unlocked)
            </a>
            <EditorPreviewLink invoiceId={invoiceId} />
          </div>
        </div>
      </div>
    </main>
  );
}

/* Editor preview — separate client island to keep the server component clean */
function EditorPreviewLink({ invoiceId }: { invoiceId: string }) {
  return (
    <a
      href={`/deliver/${invoiceId}/editor`}
      className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
    >
      View as Editor (XML Export)
    </a>
  );
}
