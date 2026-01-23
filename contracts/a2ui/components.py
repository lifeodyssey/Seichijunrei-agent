"""A2UI Component Definitions.

Components are the building blocks of A2UI surfaces.
Each component has an ID and a type-specific payload.

A2UI Component Protocol (v0.1.0)
"""

from enum import Enum
from typing import TypedDict

from .types import Alignment, Distribution, TextUsageHint


class ComponentType(str, Enum):
    """Supported A2UI component types."""

    TEXT = "Text"
    DIVIDER = "Divider"
    IMAGE = "Image"
    ROW = "Row"
    COLUMN = "Column"
    CARD = "Card"
    BUTTON = "Button"


# --- Value Types ---


class LiteralString(TypedDict):
    """String value wrapper."""

    literalString: str


# --- Component Payloads ---


class TextPayload(TypedDict, total=False):
    """Payload for Text component."""

    text: LiteralString
    usageHint: TextUsageHint  # Optional: h1, h2, h3, h4, body, caption


class DividerPayload(TypedDict):
    """Payload for Divider component."""

    axis: str  # "horizontal" or "vertical"


class ImagePayload(TypedDict):
    """Payload for Image component."""

    url: LiteralString


class ChildrenList(TypedDict):
    """Children reference list for layout components."""

    explicitList: list[str]  # List of component IDs


class RowPayload(TypedDict, total=False):
    """Payload for Row (horizontal layout) component."""

    children: ChildrenList
    distribution: Distribution  # Optional
    alignment: Alignment  # Optional


class ColumnPayload(TypedDict, total=False):
    """Payload for Column (vertical layout) component."""

    children: ChildrenList
    distribution: Distribution  # Optional
    alignment: Alignment  # Optional


class CardPayload(TypedDict):
    """Payload for Card component."""

    content: str  # ID of the content component


class ButtonPayload(TypedDict, total=False):
    """Payload for Button component."""

    label: LiteralString
    action: str  # Action name to dispatch on click
    primary: bool  # Optional: True for primary styling


# --- Component Definition ---


class ComponentPayload(TypedDict, total=False):
    """Union of all component payloads, keyed by ComponentType."""

    Text: TextPayload
    Divider: DividerPayload
    Image: ImagePayload
    Row: RowPayload
    Column: ColumnPayload
    Card: CardPayload
    Button: ButtonPayload


class Component(TypedDict):
    """A2UI Component structure.

    Each component has:
    - id: Unique identifier within the surface
    - component: The component type and its payload
    """

    id: str
    component: ComponentPayload


# --- Builder Functions ---


def text(
    component_id: str, content: str, *, usage_hint: TextUsageHint | None = None
) -> Component:
    """Build a Text component."""
    payload: TextPayload = {"text": {"literalString": content}}
    if usage_hint:
        payload["usageHint"] = usage_hint
    return {"id": component_id, "component": {"Text": payload}}


def divider(component_id: str, *, axis: str = "horizontal") -> Component:
    """Build a Divider component."""
    return {"id": component_id, "component": {"Divider": {"axis": axis}}}


def image(component_id: str, url: str) -> Component:
    """Build an Image component."""
    return {"id": component_id, "component": {"Image": {"url": {"literalString": url}}}}


def row(
    component_id: str,
    children: list[str],
    *,
    distribution: Distribution | None = None,
    alignment: Alignment | None = None,
) -> Component:
    """Build a Row (horizontal layout) component."""
    payload: RowPayload = {"children": {"explicitList": children}}
    if distribution:
        payload["distribution"] = distribution
    if alignment:
        payload["alignment"] = alignment
    return {"id": component_id, "component": {"Row": payload}}


def column(
    component_id: str,
    children: list[str],
    *,
    distribution: Distribution | None = None,
    alignment: Alignment | None = None,
) -> Component:
    """Build a Column (vertical layout) component."""
    payload: ColumnPayload = {"children": {"explicitList": children}}
    if distribution:
        payload["distribution"] = distribution
    if alignment:
        payload["alignment"] = alignment
    return {"id": component_id, "component": {"Column": payload}}


def card(component_id: str, content_id: str) -> Component:
    """Build a Card component."""
    return {"id": component_id, "component": {"Card": {"content": content_id}}}


def button(
    component_id: str, label: str, action: str, *, primary: bool = False
) -> Component:
    """Build a Button component."""
    payload: ButtonPayload = {
        "label": {"literalString": label},
        "action": action,
    }
    if primary:
        payload["primary"] = True
    return {"id": component_id, "component": {"Button": payload}}
