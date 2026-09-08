import { describe, expect, it } from "vitest";
import { LOCALES } from "../../../src/i18n/locales";
import { chatDictFor } from "../../../src/features/chat/i18n";

describe("chatDictFor", () => {
  it.each(LOCALES)("provides a full %s dictionary with 3 example chips", (locale) => {
    const dict = chatDictFor(locale);
    expect(dict.chips).toHaveLength(3);
    expect(dict.inputPlaceholder.length).toBeGreaterThan(0);
    expect(dict.busyPlaceholder.length).toBeGreaterThan(0);
    expect(dict.send.length).toBeGreaterThan(0);
    expect(dict.hintSend.length).toBeGreaterThan(0);
    expect(dict.hintCamera.length).toBeGreaterThan(0);
    expect(dict.brandTagline.length).toBeGreaterThan(0);
    expect(dict.newJourney.length).toBeGreaterThan(0);
    expect(dict.recentLabel.length).toBeGreaterThan(0);
    expect(dict.crumbJourneys.length).toBeGreaterThan(0);
    expect(dict.titleNewJourney.length).toBeGreaterThan(0);
    expect(dict.autosaved.length).toBeGreaterThan(0);
    expect(dict.coldStartHeading.length).toBeGreaterThan(0);
    expect(dict.coldStartSub.length).toBeGreaterThan(0);
    expect(dict.entryAnimeTitle.length).toBeGreaterThan(0);
    expect(dict.entryCityTitle.length).toBeGreaterThan(0);
    expect(dict.entryChatTitle.length).toBeGreaterThan(0);
    expect(dict.entryAnimePrompt.length).toBeGreaterThan(0);
    expect(dict.entryCityPrompt.length).toBeGreaterThan(0);
    expect(dict.entryChatPrompt.length).toBeGreaterThan(0);
    expect(dict.sampleLink.length).toBeGreaterThan(0);
    expect(dict.samplePrompt.length).toBeGreaterThan(0);
    expect(dict.errorBanner.length).toBeGreaterThan(0);
    expect(dict.retry.length).toBeGreaterThan(0);
    expect(dict.thinking.length).toBeGreaterThan(0);
    expect(dict.waitingSubtitle.length).toBeGreaterThan(0);
    expect(dict.footprintDetails.length).toBeGreaterThan(0);
    expect(dict.appbar.brand.length).toBeGreaterThan(0);
    expect(dict.appbar.login.length).toBeGreaterThan(0);
    expect(dict.appbar.settings.length).toBeGreaterThan(0);
  });

  it("keeps locale dictionaries distinct", () => {
    expect(chatDictFor("ja").coldStartHeading).not.toBe(chatDictFor("en").coldStartHeading);
    expect(chatDictFor("zh").coldStartHeading).not.toBe(chatDictFor("en").coldStartHeading);
  });
});
