# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1.0] - 2026-04-15

### Added

- Location button (📍) in ChatInput — tap to open geolocation picker; hidden when browser does not support geolocation
- LocationPrompt inline component with "use current location" and "enter station name" options
- Geolocation error handling: denied access shows station text input fallback; timeout shows error message with manual input
- `origin_lat` / `origin_lng` fields in API request payload — acquired coordinates are sent with next route request
- i18n keys for all location strings in ja, zh, and en dictionaries
