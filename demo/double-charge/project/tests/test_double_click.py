import pytest

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("gap", [0.05, 1.0], ids=["clicks-50ms-apart", "clicks-1s-apart"])
async def test_double_click_charges_card_once(checkout, gap):
    checkout.provider_delay = 0.5  # the real provider takes 300-900ms

    await checkout.clicks("o-1", 0, gap)

    checkout.print_timeline()
    assert len(checkout.charges) == 1
