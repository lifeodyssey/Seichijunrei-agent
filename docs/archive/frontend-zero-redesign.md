# Frontend Zero Redesign

> **Archive note (2026-04-03):** This is a product exploration snapshot. For the current shipped UI architecture and tokens, see `docs/ARCHITECTURE.md` + `frontend/app/globals.css`.

## Product Question

This product is not a general AI chat app.

The real user question is:

1. 我想围绕某部作品去巡礼，先看看哪些场景值得去。
2. 我已经在某个站点附近，想马上知道附近值不值得拐过去。
3. 我已经决定今天出发，想把路线顺一遍并减少来回折返。

So the frontend should be organized around browsing and decision-making, not message exchange.

## Core Browsing Logic

### Stage 1 · Pick an Entry

The first screen should answer one thing only:

- 你现在是从作品开始，还是从当前位置开始，还是继续上一次路线？

This is the orientation layer. It should reduce blank-page pressure and let people choose a path immediately.

### Stage 2 · Browse Candidate Scenes

After choosing a path, the user needs a scene browser.

The screen should help them answer:

- 哪些场景最有吸引力？
- 这些点彼此是不是顺路？
- 我今天大概要选 3 个还是 5 个？

This stage should prioritize:

- screenshots
- scene names
- episode / title context
- basic travel cost
- a lightweight shortlist

### Stage 3 · Build Today’s Route

Once the user has a shortlist, they switch from browsing mode to route mode.

The page should help them answer:

- 先去哪里，后去哪里？
- 总距离和时间会不会太重？
- 哪些点需要删掉或后移？

This is the main workspace of the product.

### Stage 4 · AI as an Editor, Not the Main Screen

Only after the user can already see the route should AI appear.

AI should help with:

- 压缩路线
- 调整顺序
- 保留更值得去的点
- 根据体力和时间做版本切换

AI should not be the first thing the user sees.

## Information Architecture

### `/design`

Role:
- explain the product in one screen
- offer 3 starting paths
- expose saved routes as a continuation path

Primary action:
- choose one way to start browsing

### `/design/explore`

Role:
- browse a title’s scene collection
- compare scenes and build a shortlist

Primary action:
- add scenes into today’s shortlist

### `/design/nearby`

Role:
- browse what is worth visiting near the current station
- make an immediate local decision

Primary action:
- start a light route from current location

### `/design/route`

Role:
- arrange sequence
- inspect map and total effort
- apply AI route edits

Primary action:
- finalize or refine the day’s route

## Design Principles

1. Every page has one job.
2. Browsing comes before prompting.
3. Screenshots and geography do the narrative work.
4. The route editor is the product core.
5. AI appears only when the user already has context on screen.

## Implication for the UI

The redesign should avoid:

- chat-first empty states
- many competing cards on one screen
- repeating the same message in multiple modules
- decorative SaaS dashboard patterns

The redesign should prefer:

- one dominant visual anchor per screen
- one clear next action per section
- calm editorial spacing
- lightweight route-building affordances
