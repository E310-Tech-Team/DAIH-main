"use client";

import React, { useRef } from "react";
import { cn } from "@daih/ui";
import {
  transferTabId,
  type TransferListStatus,
  type TransferTab,
} from "./transferTabs";

interface TransferStatusTabsProps {
  tabs: readonly TransferTab[];
  activeStatus: TransferListStatus;
  /** The id of the tab panel these tabs control. */
  panelId: string;
  onChange: (status: TransferListStatus) => void;
}

/** Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern). */
function nextTabIndex(
  key: string,
  index: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function TransferStatusTabs({
  tabs,
  activeStatus,
  panelId,
  onChange,
}: TransferStatusTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const target = nextTabIndex(event.key, index, tabs.length);
    if (target === null) return;
    event.preventDefault();
    onChange(tabs[target].status);
    tabRefs.current[target]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Transfer status"
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[#EBE7F5] bg-white p-1 shadow-xs"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.status === activeStatus;
        return (
          <button
            key={tab.status}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={transferTabId(tab.status)}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.status)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "min-h-[44px] shrink-0 cursor-pointer rounded-lg px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23055c] focus-visible:ring-offset-2",
              isActive
                ? "bg-[#23055c] text-white shadow-xs"
                : "text-slate-700 hover:bg-purple-50 hover:text-[#23055c]",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
