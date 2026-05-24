import json
import re
from pathlib import Path


GO_PLACEHOLDER_RE = re.compile(r"{{\s*\.([A-Za-z0-9_]+)\s*}}")
GO_IF_RE = re.compile(r"{{\s*if\s+\.([A-Za-z0-9_]+)\s*}}(.*?){{\s*end\s*}}", re.DOTALL)


class PromptSet:
    def __init__(self, directory: str):
        self.directory = Path(directory)
        manifest = json.loads((self.directory / "manifest.json").read_text(encoding="utf-8"))
        self.version = manifest["version"]
        files = manifest["files"]
        self._html_from_image = self._read(files["html_from_image"])
        self._parameters = self._read(files["parameters"])
        self._generation = self._read(files["generation"])
        self._self_evaluation = self._read(files["self_evaluation"])
        self.default_source = self._read(files["default_source"])

    def html_from_image_prompt(self) -> str:
        return self._render(self._html_from_image, {})

    def parameters_prompt(self, task_html: str) -> str:
        return self._render(self._parameters, {"TaskHTML": task_html})

    def generation_prompt(self, task_html: str, params: dict, user_comment: str = "") -> str:
        clean_comment = user_comment.strip()
        return self._render(
            self._generation,
            {
                "TaskHTML": task_html,
                "Params": format_task_parameters(params),
                "UserComment": clean_comment,
                "HasUserComment": bool(clean_comment),
            },
        )

    def self_evaluation_prompt(self, source_html: str, variant_html: str) -> str:
        return self._render(self._self_evaluation, {"SourceHTML": source_html, "VariantHTML": variant_html})

    def _read(self, filename: str) -> str:
        return (self.directory / filename).read_text(encoding="utf-8").rstrip("\n")

    def _render(self, template: str, values: dict) -> str:
        def replace_if(match: re.Match) -> str:
            key = match.group(1)
            body = match.group(2)
            return body if values.get(key) else ""

        rendered = GO_IF_RE.sub(replace_if, template)
        rendered = GO_PLACEHOLDER_RE.sub(lambda match: str(values.get(match.group(1), "")), rendered)
        return rendered


def format_task_parameters(params: dict) -> str:
    return "\n".join(
        [
            "Тип задания: " + value_or_star(params.get("task_type")),
            "Предполагаемый класс: " + value_or_star(params.get("school_class")),
            "Уровень сложности задания: " + value_or_star(params.get("difficulty")),
        ]
    )


def value_or_star(value: object) -> str:
    text = str(value or "").strip()
    return text or "*"
