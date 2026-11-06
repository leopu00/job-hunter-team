"""Lazy recipe dispatch — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])



try:
    from apply_flow_constants import (
        _optional_module, _linkedin_module,
    )
    from apply_flow_ashby import (
        AshbyRecipe,
    )
    from apply_flow_greenhouse import (
        GreenhouseRecipe,
    )
    from apply_flow_lever import (
        LeverRecipe,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        _optional_module, _linkedin_module,
    )
    from shared.skills.apply_flow_ashby import (
        AshbyRecipe,
    )
    from shared.skills.apply_flow_greenhouse import (
        GreenhouseRecipe,
    )
    from shared.skills.apply_flow_lever import (
        LeverRecipe,
    )


def _recipe_class(platform: str):
    if platform == "linkedin":
        module = _linkedin_module()
        return module.LinkedInEasyApplyRecipe if module is not None else None
    if platform == "generic":
        # A company's own careers form (the fullstack team's apply_generic).
        module = _optional_module("apply_generic")
        return module.GenericRecipe if module is not None else None
    if platform == "workday":
        module = _optional_module("workday_apply")
        return module.WorkdayRecipe if module is not None else None
    if platform == "oracle_ce":
        # Oracle Recruiting Cloud's candidate site, behind a company Apply (1944).
        module = _optional_module("oracle_ce_apply")
        return module.OracleCERecipe if module is not None else None
    if platform == "icims":
        # The iCIMS candidate portal, behind a company Apply (1843).
        module = _optional_module("icims_apply")
        return module.ICIMSRecipe if module is not None else None
    return {"ashby": AshbyRecipe, "greenhouse": GreenhouseRecipe, "lever": LeverRecipe}.get(platform)
