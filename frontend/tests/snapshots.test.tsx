/**
 * Snapshot tests for untested components.
 * These ensure render output doesn't change unexpectedly.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import defaultDict from "@/lib/dictionaries/ja.json";
import type { PilgrimagePoint, RuntimeResponse } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";

// Mock i18n for all snapshot components
vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
  useLocale: () => "ja",
  useSetLocale: () => () => {},
}));

// Mock next/dynamic
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = () => <div data-testid="dynamic-stub" />;
    Stub.displayName = "DynamicStub";
    return Stub;
  },
}));

// Wrapper for selection context
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PointSelectionContext.Provider
      value={{ selectedIds: new Set<string>(), toggle: () => {}, clear: () => {} }}
    >
      {children}
    </PointSelectionContext.Provider>
  );
}

const BASE_POINT: PilgrimagePoint = {
  id: "pt-snap-001",
  name: "宇治駅",
  name_cn: "宇治站",
  episode: 1,
  time_seconds: 85,
  screenshot_url: "https://example.com/img.jpg",
  bangumi_id: "115908",
  latitude: 34.88,
  longitude: 135.8,
  title: "響け！ユーフォニアム",
  title_cn: "吹响！上低音号",
};

describe("Snapshot: GeneralAnswer", () => {
  it("renders QA data", async () => {
    const { default: GeneralAnswer } = await import(
      "@/components/generative/GeneralAnswer"
    );
    const { container } = render(
      <GeneralAnswer
        data={{
          intent: "answer_question",
          confidence: 1,
          status: "info",
          message: "テスト回答です。",
        }}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});

describe("Snapshot: ResultAnchor", () => {
  it("renders anchor button", async () => {
    const { default: ResultAnchor } = await import(
      "@/components/chat/ResultAnchor"
    );
    const { container } = render(
      <ResultAnchor
        label="3件の結果"
        subtitle="タップして表示"
        messageId="msg-001"
        onActivate={() => {}}
        isActive={false}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});

describe("Snapshot: NearbyBubbleWrapper", () => {
  it("renders with search data", async () => {
    const { default: NearbyBubbleWrapper } = await import(
      "@/components/chat/NearbyBubbleWrapper"
    );
    const response: RuntimeResponse = {
      success: true,
      status: "ok",
      intent: "search_nearby",
      session_id: "s-001",
      message: "近くに聖地があります",
      data: {
        results: {
          rows: [BASE_POINT],
          row_count: 1,
          strategy: "geo",
          status: "ok",
        },
        message: "ok",
        status: "ok",
      },
      session: { interaction_count: 1, route_history_count: 0 },
      route_history: [],
      errors: [],
    };
    const { container } = render(<NearbyBubbleWrapper response={response} />);
    expect(container).toMatchSnapshot();
  });
});

describe("Snapshot: FallbackList", () => {
  it("renders fallback list with route data", async () => {
    const { default: FallbackList } = await import(
      "@/components/generative/FallbackList"
    );
    const { container } = render(
      <Wrapper>
        <FallbackList
          data={{
            results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
            message: "ok",
            status: "ok",
            route: {
              ordered_points: [BASE_POINT],
              point_count: 1,
              status: "ok",
            },
          }}
        />
      </Wrapper>,
    );
    expect(container).toMatchSnapshot();
  });
});

describe("Snapshot: SpotDetail", () => {
  it("renders spot detail page", async () => {
    const { default: SpotDetail } = await import(
      "@/components/generative/SpotDetail"
    );
    const { container } = render(
      <Wrapper>
        <SpotDetail
          point={BASE_POINT}
          onBack={() => {}}
          onSelect={() => {}}
          isSelected={false}
          nearbyPoints={[]}
        />
      </Wrapper>,
    );
    expect(container).toMatchSnapshot();
  });
});

describe("Snapshot: PhotoCard", () => {
  it("renders photo card", async () => {
    const { PhotoCard } = await import(
      "@/components/generative/PhotoCard"
    );
    const { container } = render(
      <PhotoCard
        point={BASE_POINT}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});

describe("Snapshot: NearbyBubble", () => {
  it("renders nearby bubble", async () => {
    const { default: NearbyBubble } = await import(
      "@/components/generative/NearbyBubble"
    );
    const { container } = render(
      <NearbyBubble
        data={{
          results: {
            rows: [BASE_POINT],
            row_count: 1,
            strategy: "geo",
            status: "ok",
          },
          message: "ok",
          status: "ok",
        }}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
