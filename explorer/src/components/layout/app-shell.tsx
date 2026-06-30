"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useAtomValue } from "jotai";

import { DetailPanel } from "@/components/layout/detail-panel";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { FlowCanvas } from "@/components/flow/flow-canvas";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAskSearch } from "@/hooks/use-ask-search";
import { useGraph } from "@/hooks/use-graph";
import { useThemeSync } from "@/hooks/use-theme-sync";
import { selectedIdAtom } from "@/stores/selection";
import { sidebarCollapsedAtom } from "@/stores/ui";

function Shell() {
  useAskSearch();
  useGraph();
  useThemeSync();
  const collapsed = useAtomValue(sidebarCollapsedAtom);
  const selectedId = useAtomValue(selectedIdAtom);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <Header />
      {/* body: controls + canvas (resizable), then the docked detail panel —
          docking reflows the canvas so the graph always fills the visible width */}
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full min-w-0 flex-1">
          {!collapsed && (
            <ResizablePanel
              key="sidebar"
              id="sidebar"
              minSize="240px"
              defaultSize="340px"
              maxSize="460px"
              className="min-w-0"
            >
              <Sidebar />
            </ResizablePanel>
          )}
          {!collapsed && <ResizableHandle key="handle" withHandle />}
          <ResizablePanel key="canvas" id="canvas" className="min-w-0">
            <main className="oasis-atmosphere h-full overflow-hidden">
              <FlowCanvas />
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
        {selectedId && (
          <aside className="w-[360px] max-w-[80vw] shrink-0 overflow-hidden border-l duration-300 animate-in slide-in-from-right">
            <DetailPanel />
          </aside>
        )}
      </div>
    </div>
  );
}

export function OntologyExplorer() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}
