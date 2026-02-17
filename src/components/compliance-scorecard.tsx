"use client";

import { Badge } from "@/components/ui/badge";
import {
  CheckCircleIcon,
  XCircleIcon,
  AlertTriangleIcon,
  MinusCircleIcon,
} from "lucide-react";

interface ScorecardCategory {
  category: string;
  status: "pass" | "fail" | "partial" | "not-applicable";
  score: number;
  requirement: string;
  finding: string;
}

export interface ScorecardData {
  overallScore: number;
  verdict: "APPROVED" | "REJECTED";
  categories: ScorecardCategory[];
  reviewedSections: number;
}

const STATUS_CONFIG = {
  pass: {
    icon: CheckCircleIcon,
    label: "Pass",
    className: "text-emerald-600 dark:text-emerald-400",
    badgeClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  },
  fail: {
    icon: XCircleIcon,
    label: "Fail",
    className: "text-red-600 dark:text-red-400",
    badgeClass: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
  },
  partial: {
    icon: AlertTriangleIcon,
    label: "Partial",
    className: "text-amber-600 dark:text-amber-400",
    badgeClass: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  },
  "not-applicable": {
    icon: MinusCircleIcon,
    label: "N/A",
    className: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
} as const;

function getOverallBadgeClass(score: number) {
  if (score >= 80) return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400";
  if (score >= 60) return "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400";
  return "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400";
}

export function ComplianceScorecard({ data }: { data: ScorecardData }) {
  return (
    <div className="rounded-lg border border-border/60 mb-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-muted/30 border-b border-border/40">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>Compliance Scorecard</span>
          <span className="text-xs text-muted-foreground font-normal">
            {data.reviewedSections} section{data.reviewedSections !== 1 ? "s" : ""} reviewed
          </span>
        </div>
        <Badge variant="outline" className={getOverallBadgeClass(data.overallScore)}>
          {data.overallScore}%
        </Badge>
      </div>

      {/* Category rows */}
      <div className="divide-y divide-border/40">
        {data.categories.map((cat) => {
          const config = STATUS_CONFIG[cat.status];
          const Icon = config.icon;
          return (
            <div key={cat.category} className="px-3 py-2 flex items-start gap-2.5">
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.className}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{cat.category}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${config.badgeClass}`}
                  >
                    {cat.score}%
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {cat.finding}
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  Req: {cat.requirement}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
