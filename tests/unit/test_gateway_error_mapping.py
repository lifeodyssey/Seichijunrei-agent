from unittest.mock import AsyncMock

import pytest

from application.errors import ExternalServiceError, InvalidInputError
from clients.anitabi_gateway import AnitabiClientGateway
from clients.bangumi_gateway import BangumiClientGateway
from clients.errors import APIError


async def test_anitabi_gateway_maps_api_error_to_external_service_error() -> None:
    client = AsyncMock()
    client.get_bangumi_points.side_effect = APIError("anitabi down")

    gateway = AnitabiClientGateway(client=client)

    with pytest.raises(ExternalServiceError) as exc_info:
        await gateway.get_bangumi_points("123")

    assert exc_info.value.service == "anitabi"
    assert "anitabi down" in str(exc_info.value)


async def test_bangumi_gateway_maps_api_error_to_external_service_error() -> None:
    client = AsyncMock()
    client.search_subject.side_effect = APIError("bangumi down")

    gateway = BangumiClientGateway(client=client)

    with pytest.raises(ExternalServiceError) as exc_info:
        await gateway.search_subject(keyword="k-on", subject_type=2, max_results=10)

    assert exc_info.value.service == "bangumi"
    assert "bangumi down" in str(exc_info.value)


async def test_bangumi_gateway_maps_value_error_to_invalid_input_error() -> None:
    client = AsyncMock()
    client.search_subject.side_effect = ValueError("Keyword cannot be empty")

    gateway = BangumiClientGateway(client=client)

    with pytest.raises(InvalidInputError, match="Keyword cannot be empty"):
        await gateway.search_subject(keyword="", subject_type=2, max_results=10)
