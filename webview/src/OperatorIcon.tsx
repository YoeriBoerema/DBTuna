import React from "react";
import type { PlanNode } from "../../packages/plan-core/src/types";
export function OperatorIcon({ node }: { node: PlanNode }) {
  let shape: React.ReactNode;
  if (node.properties.Operation === "Insert")
    shape = (
      <>
        <path d="M4 16h15m-5-5 5 5-5 5" />
        <path d="M22 5h6v22h-6" />
      </>
    );
  else
    switch (node.category) {
      case "TABLE_SCAN":
        shape = (
          <>
            <ellipse cx="16" cy="7" rx="11" ry="4" />
            <path d="M5 7v18c0 5 22 5 22 0V7M5 16c0 5 22 5 22 0" />
          </>
        );
        break;
      case "INDEX_ACCESS":
        shape = (
          <>
            <circle cx="11" cy="12" r="7" />
            <path d="m16 17 12 12m-5-5 4-4m-8 0 4-4" />
          </>
        );
        break;
      case "JOIN":
        shape = (
          <>
            <path d="M3 6h8l10 10h8M3 26h8l10-10M25 12l4 4-4 4" />
            <circle cx="11" cy="6" r="2" />
            <circle cx="11" cy="26" r="2" />
          </>
        );
        break;
      case "HASH":
        shape = <path d="m12 4-4 24M24 4l-4 24M4 12h24M3 21h24" />;
        break;
      case "SORT":
        shape = (
          <>
            <path d="M7 5v22m-4-4 4 4 4-4M17 7h4M17 14h8M17 21h12" />
          </>
        );
        break;
      case "AGGREGATE":
        shape = <path d="M26 5H7l10 11L7 27h19" />;
        break;
      case "LIMIT":
        shape = (
          <>
            <path d="M5 7h22M8 14h16M11 21h10M7 27h18" />
          </>
        );
        break;
      case "MATERIALIZE":
        shape = (
          <>
            <rect x="9" y="4" width="19" height="20" rx="2" />
            <path d="M4 10v18h18M14 10h9M14 15h9" />
          </>
        );
        break;
      case "PARALLEL":
        shape = (
          <>
            <path d="M3 16h7m0 0 8-10h10M10 16h18M10 16l8 10h10m-4-24 4 4-4 4m0 2 4 4-4 4m0 2 4 4-4 4" />
          </>
        );
        break;
      case "APPEND":
        shape = (
          <>
            <path d="M3 6h7l8 10h11M3 26h7l8-10M3 16h26m-4-4 4 4-4 4" />
          </>
        );
        break;
      default:
        shape = (
          <>
            <rect x="5" y="5" width="22" height="22" rx="4" />
            <path d="M10 12h12M10 17h12M10 22h7" />
          </>
        );
    }
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}
