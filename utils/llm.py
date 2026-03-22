"""
LLM client utilities.

After the v2 refactor, all LLM reasoning is handled by the pydantic-ai agent
layer. The core Python orchestration and domain agents no longer depend on
any local LLM client.

This module is kept as an empty placeholder to avoid import errors in older
code or documentation. New code should not import from utils.llm.
"""
