"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  Loader2,
  Plus,
  Send,
  Check,
  X as XIcon,
  Clock,
  Trophy,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { useForge, ForgeTask, TaskStatus } from "@/hooks/use-forge";
import { formatRlo, parseRloToRaw, txLink, short, cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export function GridPanel() {
  const wallet = useWallet();
  const {
    tasks,
    loading,
    submitting,
    postTask,
    bid,
    assign,
    submitWork,
    approve,
    reject,
    fetchBids,
  } = useForge();

  if (!wallet.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bounties</CardTitle>
          <CardDescription>
            Connect a wallet to post a bounty or apply for one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <PostTaskCard onPost={postTask} submitting={submitting} />
      <TaskBoard
        tasks={tasks}
        loading={loading}
        submitting={submitting}
        myPubkey={wallet.publicKey!}
        onBid={bid}
        onAssign={assign}
        onSubmit={submitWork}
        onApprove={approve}
        onReject={reject}
        fetchBids={fetchBids}
      />
    </div>
  );
}

// ---------- post task ----------

function PostTaskCard({
  onPost,
  submitting,
}: {
  onPost: (p: {
    description: string;
    reward: bigint;
    deadlineUnix: number;
  }) => Promise<{ sig: string; task: PublicKey }>;
  submitting: boolean;
}) {
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("");
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!description.trim()) {
      toast.error("Description required");
      return;
    }
    let raw: bigint;
    try {
      raw = parseRloToRaw(reward || "0");
      if (raw <= 0n) throw new Error("Reward must be > 0");
    } catch (e: any) {
      toast.error("Invalid reward", { description: e?.message });
      return;
    }
    const h = parseInt(hours, 10);
    if (!h || h < 1) {
      toast.error("Hours must be ≥ 1");
      return;
    }
    setBusy(true);
    try {
      const deadline = Math.floor(Date.now() / 1000) + h * 3600;
      const { sig } = await onPost({
        description: description.slice(0, 280),
        reward: raw,
        deadlineUnix: deadline,
      });
      toast.success("Bounty posted", {
        description: `${formatRlo(raw)} $RLO escrowed`,
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
      setDescription("");
      setReward("");
    } catch (e: any) {
      toast.error("Couldn't post", {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-4">
        <CardTitle>Post a bounty</CardTitle>
        <CardDescription>
          Reward locks in escrow. Released to the worker when you approve.
        </CardDescription>
      </div>

      <div className="grid gap-3">
        <textarea
          placeholder="What do you need done?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={280}
          className="flex w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-ink-muted">
              Reward
            </label>
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
            <div className="mt-1 text-xs text-ink-muted">$RLO, escrowed</div>
          </div>
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-ink-muted">
              Deadline
            </label>
            <Input
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <div className="mt-1 text-xs text-ink-muted">hours from now</div>
          </div>
          <div className="self-end">
            <Button
              variant="accent"
              size="lg"
              onClick={go}
              disabled={busy || submitting}
              className="w-full"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Post
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- task board ----------

type FilterTab = "all" | "open" | "assigned" | "submitted" | "approved" | "rejected";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "assigned", label: "In Progress" },
  { id: "submitted", label: "Delivered" },
  { id: "approved", label: "Paid" },
  { id: "rejected", label: "Refunded" },
];

function TaskBoard(props: {
  tasks: ForgeTask[];
  loading: boolean;
  submitting: boolean;
  myPubkey: PublicKey;
  onBid: (t: PublicKey) => Promise<string>;
  onAssign: (t: PublicKey, a: PublicKey) => Promise<string>;
  onSubmit: (t: PublicKey, hash: Uint8Array, uri: string) => Promise<string>;
  onApprove: (t: ForgeTask) => Promise<string>;
  onReject: (t: ForgeTask) => Promise<string>;
  fetchBids: (t: PublicKey) => Promise<{ pubkey: PublicKey; agent: PublicKey; timestamp: number }[]>;
}) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const filtered =
    filter === "all" ? props.tasks : props.tasks.filter((t) => t.status === filter);

  function count(id: FilterTab) {
    if (id === "all") return props.tasks.length;
    return props.tasks.filter((t) => t.status === id).length;
  }

  if (props.loading && props.tasks.length === 0) {
    return (
      <Card>
        <div className="text-sm text-ink-muted">Loading bounties…</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4">
        <CardTitle className="mb-3">Live bounties</CardTitle>
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map((tab) => {
            const n = count(tab.id);
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                  active
                    ? "bg-brand text-white"
                    : "bg-surface text-ink-muted border border-line hover:border-brand hover:text-ink"
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                    active ? "bg-white/20 text-white" : "bg-brand-wash text-brand"
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {props.tasks.length === 0 ? (
        <GridEmptyState />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-bg py-8 text-center text-sm text-ink-muted">
          No bounties match this filter.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((t) => (
            <TaskRow
              key={t.pubkey.toBase58()}
              task={t}
              myPubkey={props.myPubkey}
              submitting={props.submitting}
              onBid={props.onBid}
              onAssign={props.onAssign}
              onSubmit={props.onSubmit}
              onApprove={props.onApprove}
              onReject={props.onReject}
              fetchBids={props.fetchBids}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function GridEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-wash">
        <LayoutGrid className="h-7 w-7 text-brand" />
      </div>
      <div>
        <p className="font-semibold text-ink">No bounties yet</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          Post the first bounty and get work done on-chain.
        </p>
      </div>
    </div>
  );
}


function TaskRow(props: {
  task: ForgeTask;
  myPubkey: PublicKey;
  submitting: boolean;
  onBid: (t: PublicKey) => Promise<string>;
  onAssign: (t: PublicKey, a: PublicKey) => Promise<string>;
  onSubmit: (t: PublicKey, hash: Uint8Array, uri: string) => Promise<string>;
  onApprove: (t: ForgeTask) => Promise<string>;
  onReject: (t: ForgeTask) => Promise<string>;
  fetchBids: (t: PublicKey) => Promise<{ pubkey: PublicKey; agent: PublicKey; timestamp: number }[]>;
}) {
  const t = props.task;
  const isPoster = t.poster.equals(props.myPubkey);
  const isAgent = t.agent && t.agent.equals(props.myPubkey);
  const [expanded, setExpanded] = useState(false);
  const [bids, setBids] = useState<
    { pubkey: PublicKey; agent: PublicKey; timestamp: number }[]
  >([]);
  const [uri, setUri] = useState("");

  useEffect(() => {
    if (expanded && t.status === "open") {
      props.fetchBids(t.pubkey).then(setBids);
    }
  }, [expanded, t.pubkey, t.status]);

  const timeLeft = Math.max(0, t.deadline - Math.floor(Date.now() / 1000));

  async function tryAction(fn: () => Promise<string>, label: string) {
    try {
      const sig = await fn();
      toast.success(label, {
        action: { label: "View", onClick: () => window.open(txLink(sig)) },
      });
    } catch (e: any) {
      toast.error(`${label} failed`, {
        description: extractAnchorError(e) ?? String(e?.message ?? e),
      });
    }
  }

  return (
    <div className="rounded-xl border border-line bg-bg p-4 transition hover:border-brand/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            {isPoster ? <Badge variant="muted">You posted</Badge> : null}
            {isAgent ? <Badge variant="brand">Yours</Badge> : null}
            <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
              <Clock className="h-3 w-3" />
              {timeLeft > 0 ? formatDuration(timeLeft) + " left" : "expired"}
            </span>
          </div>
          <div className="break-words text-sm leading-relaxed text-ink">
            {t.description}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="font-semibold text-cta">
              {formatRlo(t.reward)} $RLO
            </span>
            <span className="font-mono text-ink-muted">
              by {short(t.poster.toBase58(), 4, 4)}
            </span>
            {t.status !== "open" && (
              <span className="font-mono text-ink-muted">
                → {short(t.agent.toBase58(), 4, 4)}
              </span>
            )}
          </div>
          {t.resultUri ? (
            <a
              href={t.resultUri}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block break-all text-xs text-brand hover:text-brand-dark"
            >
              ↳ {t.resultUri}
            </a>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {t.status === "open" && !isPoster && (
            <Button
              variant="primary"
              size="sm"
              disabled={props.submitting}
              onClick={() =>
                tryAction(() => props.onBid(t.pubkey), "Applied")
              }
            >
              Apply
            </Button>
          )}
          {t.status === "open" && isPoster && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {bids.length > 0 ? `${bids.length} applicant${bids.length === 1 ? "" : "s"}` : "View applicants"}
            </Button>
          )}
          {t.status === "assigned" && isAgent && (
            <Button
              variant="accent"
              size="sm"
              disabled={props.submitting || !uri.trim()}
              onClick={() =>
                tryAction(async () => {
                  const hash = await sha256Bytes(uri);
                  return props.onSubmit(t.pubkey, hash, uri);
                }, "Delivered")
              }
            >
              <Send className="h-4 w-4" /> Deliver
            </Button>
          )}
          {t.status === "submitted" && isPoster && (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={props.submitting}
                onClick={() => tryAction(() => props.onApprove(t), "Approved")}
              >
                <Check className="h-4 w-4" /> Approve
              </Button>
              <RejectWithConfirm
                submitting={props.submitting}
                onReject={() => tryAction(() => props.onReject(t), "Rejected")}
              />
            </>
          )}
        </div>
      </div>

      {/* Deliver form for the assigned agent. */}
      {t.status === "assigned" && isAgent && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <label className="mb-1 block text-xs uppercase tracking-wide text-ink-muted">
            Deliverable URL
          </label>
          <Input
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="ipfs://… or https://…"
          />
          <div className="mt-1 text-xs text-ink-muted">
            We hash the URL for tamper-evidence and store both on-chain.
          </div>
        </div>
      )}

      {/* Applicant list (visible to poster on Open tasks). */}
      {expanded && t.status === "open" && isPoster && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Applicants
          </div>
          {bids.length === 0 ? (
            <div className="text-sm text-ink-muted">No applicants yet.</div>
          ) : (
            <ul className="grid gap-2">
              {bids.map((b) => (
                <li
                  key={b.pubkey.toBase58()}
                  className="flex items-center justify-between"
                >
                  <span className="font-mono text-xs text-ink">
                    {short(b.agent.toBase58(), 6, 6)}
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={props.submitting}
                    onClick={() =>
                      tryAction(
                        () => props.onAssign(t.pubkey, b.agent),
                        "Assigned"
                      )
                    }
                  >
                    <Trophy className="h-4 w-4" /> Choose
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RejectWithConfirm({
  submitting,
  onReject,
}: {
  submitting: boolean;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" disabled={submitting} onClick={() => setOpen(true)}>
        <XIcon className="h-4 w-4" /> Reject
      </Button>
      <ConfirmModal
        isOpen={open}
        title="Reject and refund?"
        description="Escrowed funds will be returned to your wallet. The worker will not be paid."
        confirmLabel="Reject"
        destructive
        onConfirm={onReject}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; variant: any }> = {
    open: { label: "Open", variant: "brand" },
    assigned: { label: "In progress", variant: "warn" },
    submitted: { label: "Delivered", variant: "warn" },
    approved: { label: "Paid", variant: "success" },
    rejected: { label: "Refunded", variant: "danger" },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

function extractAnchorError(e: any): string | undefined {
  const msg = String(e?.message ?? e ?? "");
  const match = msg.match(/(?:Error Code:\s*|Error:\s*)([A-Z][A-Za-z]+)/);
  return match?.[1];
}
