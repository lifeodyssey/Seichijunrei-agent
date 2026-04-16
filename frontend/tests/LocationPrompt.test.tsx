/**
 * AC: LocationPrompt shows "現在地を使う" and "駅名を入力" options inline -> unit
 * AC: Geolocation denied by user — shows text input fallback -> unit
 * AC: Geolocation API timeout — shows error message, allows manual input -> unit
 * AC: Location prompt text rendered in current locale -> unit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LocationPrompt from "@/components/chat/LocationPrompt";
import { LocaleProvider } from "@/lib/i18n-context";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";

const jaFull = jaDict as unknown as Dict;
const enFull = enDict as unknown as Dict;

type MockGeolocation = {
  getCurrentPosition: ReturnType<typeof vi.fn>;
};

function buildGeoMock(): MockGeolocation {
  return { getCurrentPosition: vi.fn() };
}

function renderPrompt(
  props: Partial<React.ComponentProps<typeof LocationPrompt>> = {},
  dict: Dict = jaFull,
) {
  const defaultProps: React.ComponentProps<typeof LocationPrompt> = {
    onCoords: vi.fn(),
    onStation: vi.fn(),
    onDismiss: vi.fn(),
    dict,
    locale: "ja",
    ...props,
  };
  return render(
    <LocaleProvider>
      <LocationPrompt {...defaultProps} />
    </LocaleProvider>,
  );
}

describe("LocationPrompt", () => {
  let originalGeo: Geolocation | undefined;

  beforeEach(() => {
    originalGeo = navigator.geolocation;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: originalGeo,
      configurable: true,
    });
  });

  it("renders 'use current location' and 'enter station' options in ja locale", () => {
    renderPrompt();
    expect(screen.getByText("現在地を使う")).toBeInTheDocument();
    expect(screen.getByText("駅名を入力")).toBeInTheDocument();
  });

  it("renders translated options in en locale", () => {
    renderPrompt({ locale: "en" }, enFull);
    expect(screen.getByText("Use current location")).toBeInTheDocument();
    expect(screen.getByText("Enter station name")).toBeInTheDocument();
  });

  it("shows acquiring message while geolocation is pending", async () => {
    const geo = buildGeoMock();
    // never resolves — simulates pending geo
    geo.getCurrentPosition.mockImplementation(() => {});
    Object.defineProperty(navigator, "geolocation", {
      value: geo,
      configurable: true,
    });

    renderPrompt();
    await userEvent.click(screen.getByText("現在地を使う"));

    expect(await screen.findByText("位置情報を取得中...")).toBeInTheDocument();
  });

  it("calls onCoords with lat/lng on successful geolocation", async () => {
    const onCoords = vi.fn();
    const geo = buildGeoMock();
    geo.getCurrentPosition.mockImplementation(
      (success: PositionCallback) => {
        success({ coords: { latitude: 35.0, longitude: 135.0 } } as GeolocationPosition);
      },
    );
    Object.defineProperty(navigator, "geolocation", {
      value: geo,
      configurable: true,
    });

    renderPrompt({ onCoords });
    await userEvent.click(screen.getByText("現在地を使う"));

    await waitFor(() => {
      expect(onCoords).toHaveBeenCalledWith(35.0, 135.0);
    });
  });

  it("shows text input fallback when geolocation is denied", async () => {
    const geo = buildGeoMock();
    geo.getCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, message: "denied" } as GeolocationPositionError);
      },
    );
    Object.defineProperty(navigator, "geolocation", {
      value: geo,
      configurable: true,
    });

    renderPrompt();
    await userEvent.click(screen.getByText("現在地を使う"));

    await waitFor(() => {
      expect(screen.getByText("位置情報が拒否されました")).toBeInTheDocument();
    });
    // Station input visible after denial
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows error message and manual input on timeout", async () => {
    const geo = buildGeoMock();
    geo.getCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 3, message: "timeout" } as GeolocationPositionError);
      },
    );
    Object.defineProperty(navigator, "geolocation", {
      value: geo,
      configurable: true,
    });

    renderPrompt();
    await userEvent.click(screen.getByText("現在地を使う"));

    await waitFor(() => {
      expect(
        screen.getByText("位置情報の取得がタイムアウトしました"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onStation with input value when station form is submitted", async () => {
    const onStation = vi.fn();
    renderPrompt({ onStation });

    await userEvent.click(screen.getByText("駅名を入力"));
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "宇治駅");
    fireEvent.submit(input.closest("form")!);

    expect(onStation).toHaveBeenCalledWith("宇治駅");
  });

  it("calls onDismiss when dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    renderPrompt({ onDismiss });

    const cancelBtn = screen.getByLabelText("dismiss location prompt");
    await userEvent.click(cancelBtn);
    expect(onDismiss).toHaveBeenCalled();
  });
});
