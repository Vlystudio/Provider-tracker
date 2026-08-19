from pathlib import Path

import pytest
from django.template.loader import get_template

TEMPLATE_ROOT = Path(__file__).resolve().parents[1] / "templates"


@pytest.mark.parametrize(
    "template_path",
    sorted(path.relative_to(TEMPLATE_ROOT).as_posix() for path in TEMPLATE_ROOT.rglob("*.html")),
)
def test_templates_compile_and_keep_reviewable_lines(template_path):
    get_template(template_path)
    source = (TEMPLATE_ROOT / template_path).read_text(encoding="utf-8")
    longest = max((len(line) for line in source.splitlines()), default=0)
    assert longest <= 180, f"{template_path} has a {longest}-character line"
