/**
 * /deliver/[invoiceId]/editor — Editor's view of the delivery portal.
 * Shows the "Export Comments to Premiere/DaVinci (.XML)" button and
 * an EDITOR role badge on their comments.
 */
import { VideoReviewPlayer } from "@/components/deliver/video-review-player";

export const dynamic = "force-dynamic";

type EditorDeliverPageProps = {
  params: Promise<{ invoiceId: string }>;
};

export default async function EditorDeliverPage({ params }: EditorDeliverPageProps) {
  const { invoiceId } = await params;

  const mockInvoice = {
    invoiceId,
    clientName: "Priya Sharma",
    projectTitle: "Brand Reel – Q3 Launch Campaign",
    amount: 566.74,
    currency: "USD",
    videoSrc: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    paymentStatus: "unpaid" as const,
    isEditor: true,
  };

  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-96 w-[60rem] -translate-x-1/2 rounded-full bg-secondary/8 blur-[140px]" />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Editor View
            </p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">
              {mockInvoice.projectTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Editor Mode
          </div>
        </div>

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

        <VideoReviewPlayer {...mockInvoice} />

        <div className="mt-6 rounded-xl border border-dashed border-border bg-card/40 px-4 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Demo Controls
          </p>
          <a
            href={`/deliver/${invoiceId}`}
            className="rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            &larr; Back to Client View
          </a>
        </div>
      </div>
    </main>
  );
}
