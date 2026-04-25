# Landing Page Image Prompts

Generated for AI image tools (Midjourney / DALL-E / Flux). All images must be original — no anime characters or copyrighted content.

## 1. Hero Background

**File:** `public/images/hero-bg.webp`
**Used in:** `LandingPage.tsx` Section 1 background (replaces CSS gradient)
**Size:** 1920x1080, WebP

> A dreamy, soft-focus aerial photograph of a Japanese residential neighborhood at golden hour. Cherry blossom trees line a narrow street, with a traditional shrine gate (torii) visible in the distance. The scene is bathed in warm afternoon light with lens flare. No anime characters or copyrighted content. Photographic style, 16:9 aspect ratio, shot on Canon EOS R5. Color palette: warm peach, soft blue sky, muted greens. The image should feel nostalgic and inviting, evoking the feeling of discovering a special place.

---

## 2. How It Works — Step Illustrations (x3)

**Files:** `public/images/step-1.webp`, `step-2.webp`, `step-3.webp`
**Used in:** `LandingPage.tsx` Section 2, above each step card
**Size:** 640x640, WebP

### Step 1 — Search anime

> A clean, minimalist flat illustration of a smartphone showing a search interface with Japanese text, surrounded by small floating anime-related icons (film reel, map pin, star). Soft blue and white color scheme on a light background. No copyrighted characters. Illustration style, square format.

### Step 2 — Discover spots

> A warm, inviting flat illustration showing a map with glowing pins marking real locations, connected by dotted walking paths. A small camera icon and a compare-photo icon float nearby. Soft coral and blue tones. Illustration style, square format.

### Step 3 — Plan route

> A cheerful flat illustration of a walking route timeline showing stops with small landmark icons, arrival times, and a total distance badge. Warm yellow and blue accents on a clean white background. Illustration style, square format.

---

## 3. Hero Floating Cards — Real Spot Photos (x6)

**Files:** `public/images/spots/uji-bridge.webp`, `suga-shrine.webp`, `uji-river-path.webp`, `shinanomachi-bridge.webp`, `keihan-uji.webp`, `yoyogi-park.webp`
**Used in:** `LandingPage.tsx` Section 1, replaces `FLOAT_CARDS` anitabi.cn URLs in `LandingData.ts`
**Size:** 480x320 (3:2), WebP

### Card 1 — Uji Bridge (Eupho)

> A peaceful photograph of Uji Bridge in Kyoto, Japan, with the Uji River flowing beneath. Morning mist, soft light, traditional architecture visible. No people, no text. Photographic, 3:2 landscape.

### Card 2 — Suga Shrine stairs (Your Name)

> A photograph looking up the stone stairway at Suga Shrine in Shinjuku, Tokyo. Late afternoon golden light filters through trees. The famous red railing visible. No people, no text. Photographic, 3:2 landscape.

### Card 3 — Uji River path (Eupho)

> A serene photograph of a walking path along the Uji River in Kyoto, with willow trees and traditional stone lanterns. Soft morning light. No people, no text. Photographic, 3:2 landscape.

### Card 4 — Shinanomachi Bridge (Your Name)

> An urban photograph of Shinanomachi pedestrian bridge in Shinjuku at sunset. City skyline visible, warm orange and blue sky. No people, no text. Photographic, 3:2 landscape.

### Card 5 — Keihan Uji Station (Eupho)

> A photograph of Keihan Uji Station entrance with its distinctive modern architecture. Cherry blossoms in frame. Bright spring day. No people, no text. Photographic, 3:2 landscape.

### Card 6 — Yoyogi Park (Weathering with You)

> A photograph of Yoyogi Park in Tokyo, green trees with dappled sunlight creating a dreamy atmosphere. A small traditional torii gate visible among the foliage. No people, no text. Photographic, 3:2 landscape.

---

## Code Changes After Image Generation

Once images are generated and placed in `public/images/`, update `LandingData.ts`:

```ts
// Replace FLOAT_CARDS src values:
// "https://image.anitabi.cn/..." → "/images/spots/uji-bridge.webp"
```

And add hero background in `LandingPage.tsx` Section 1:

```tsx
// Add behind the gradient div:
<img src="/images/hero-bg.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
```
