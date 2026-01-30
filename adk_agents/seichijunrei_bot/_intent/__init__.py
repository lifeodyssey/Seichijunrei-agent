"""Intent module for hybrid routing with LLM-based intent classification.

This module provides:
- Intent: Enum for type-safe intent management
- ClassifierDecision: Structured output schema for classifier decisions
- ClassifierParameters: Parameters model for skill execution
- IntentClassifier: LLM agent for ambiguous input classification
- IntentRouter: Fast/slow path routing based on input clarity
"""

from .classifier import (
    create_intent_classifier,
    format_classifier_prompt,
    intent_classifier,
)
from .intent import Intent
from .router import IntentRouter
from .schemas import ClassifierDecision, ClassifierParameters

__all__ = [
    "Intent",
    "IntentRouter",
    "ClassifierDecision",
    "ClassifierParameters",
    "create_intent_classifier",
    "format_classifier_prompt",
    "intent_classifier",
]
