"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { RouteData } from "../../lib/types";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import TimelineSidebar from "./TimelineSidebar";
import MobileTimelineDrawer from "./MobileTimelineDrawer";
import FallbackList from "./FallbackList";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), {
  ssr: false,
});

interface RoutePlannerWizardProps {
  data: RouteData;
}

export default function RoutePlannerWizard({ data }: RoutePlannerWizardProps) {
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [, setPacing] = useState<"chill" | "normal" | "packed">(
    data.route.timed_itinerary?.pacing ?? "normal",
  );

  const itinerary = data.route.timed_itinerary;
  const points = data.route.ordered_points;
  const animeTitle = points[0]?.title_cn || points[0]?.title || "";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={`flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] ${isMobile ? "px-3 py-2" : "px-4 py-3"}`}
      >
        {animeTitle && (
          <h2 className="font-[family-name:var(--app-font-display)] text-base font-semibold text-[var(--color-fg)]">
            {animeTitle}
          </h2>
        )}
        <div className="flex-1" />
        <Tabs
          defaultValue="normal"
          onValueChange={(v: string | number | null) => {
            if (typeof v === "string") setPacing(v as "chill" | "normal" | "packed");
          }}
        >
          <TabsList className="h-7">
            <TabsTrigger value="chill" className="text-xs px-2">ゆっくり</TabsTrigger>
            <TabsTrigger value="normal" className="text-xs px-2">普通</TabsTrigger>
            <TabsTrigger value="packed" className="text-xs px-2">詰め込み</TabsTrigger>
          </TabsList>
        </Tabs>
        <Badge variant="secondary" className="text-xs">🚶 徒歩</Badge>
        {itinerary && (
          <span className="text-xs text-[var(--color-muted-fg)]">{itinerary.spot_count} spots</span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <PilgrimageMap points={points} route={points} height="100%" />
          {itinerary && (
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute bottom-3 left-3 z-[500] bg-[var(--color-bg)]/90 backdrop-blur-sm"
                  />
                }
              >
                ≡ スポット
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle className="font-[family-name:var(--app-font-display)]">
                    スポット一覧
                  </SheetTitle>
                </SheetHeader>
                <ScrollArea className="flex-1 px-4">
                  <ul className="space-y-3 pb-4">
                    {itinerary.stops.map((stop) => (
                      <li key={stop.cluster_id}>
                        <p className="text-sm font-medium text-[var(--color-fg)]">{stop.name}</p>
                        <Badge variant="secondary" className="mt-0.5 text-[10px]">
                          {stop.photo_count} photos
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          )}
        </div>
        {!isMobile && (
          itinerary ? <TimelineSidebar itinerary={itinerary} /> : <FallbackList data={data} />
        )}
      </div>

      {isMobile && <MobileTimelineDrawer itinerary={itinerary} data={data} />}
    </div>
  );
}
