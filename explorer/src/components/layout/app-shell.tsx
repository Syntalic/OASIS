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
import { useGraph } from "@/hooks/use-graph";
import { useThemeSync } from "@/hooks/use-theme-sync";
import { sidebarCollapsedAtom } from "@/stores/ui";

function Shell() {
  useGraph();
  useThemeSync();
  const collapsed = useAtomValue(sidebarCollapsedAtom);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <Header />
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
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
            <main className="oasis-atmosphere relative h-full overflow-hidden">
              <FlowCanvas />
              <DetailPanel />
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
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
