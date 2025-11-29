"""
Pydantic schemas for LLM structured outputs.

These schemas define the expected structure for LLM responses,
ensuring type-safe and validated outputs from Gemini models.
"""

from pydantic import BaseModel, Field


class BangumiNameExtraction(BaseModel):
    """Schema for extracting bangumi name from user query."""

    bangumi_name: str = Field(
        description="The extracted bangumi (anime) name, with symbols like 《》removed"
    )


class BangumiSelection(BaseModel):
    """Schema for selecting the best bangumi match from search results."""

    id: int = Field(description="The ID of the selected bangumi")
    name: str = Field(description="Original name of the bangumi (usually Japanese)")
    name_cn: str = Field(description="Chinese name of the bangumi")
    confidence: float = Field(description="Match confidence score between 0.0 and 1.0")
    reasoning: str = Field(
        description="1-2 sentences explaining why this bangumi was selected"
    )
