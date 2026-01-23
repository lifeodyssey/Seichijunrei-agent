"""Session state keys for the Seichijunrei ADK app.

These constants centralize the state shape shared across agents/workflows so we
can refactor routing/orchestration without scattering magic strings.
"""

EXTRACTION_RESULT = "extraction_result"
BANGUMI_CANDIDATES = "bangumi_candidates"
SELECTED_BANGUMI = "selected_bangumi"

ALL_POINTS = "all_points"
POINTS_META = "points_meta"
POINTS_SELECTION_RESULT = "points_selection_result"
ROUTE_PLAN = "route_plan"

# Backward-compatibility (older workflow shapes)
BANGUMI_RESULT = "bangumi_result"

STAGE1_STATE_KEYS = {
    EXTRACTION_RESULT,
    BANGUMI_CANDIDATES,
}

STAGE2_STATE_KEYS = {
    SELECTED_BANGUMI,
    ALL_POINTS,
    POINTS_META,
    POINTS_SELECTION_RESULT,
    ROUTE_PLAN,
}

ALL_STATE_KEYS = STAGE1_STATE_KEYS | STAGE2_STATE_KEYS | {BANGUMI_RESULT}
