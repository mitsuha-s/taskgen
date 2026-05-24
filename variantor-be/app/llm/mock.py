from app.llm.base import LLMResponse


DEFAULT_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>English Grammar Test</title>
</head>
<body>
  <h1>English Grammar Test</h1>
  <h2>Task 1</h2>
  <p>Choose the correct answer.</p>
  <ol>
    <li>She ___ to school yesterday.
      <ul><li>go</li><li>went</li><li>goes</li></ul>
    </li>
    <li>They ___ football every Sunday.
      <ul><li>plays</li><li>play</li><li>played</li></ul>
    </li>
  </ol>
  <h2>Task 2</h2>
  <p>Match the questions with the answers.</p>
  <ol>
    <li>How old are you?</li>
    <li>Where do you live?</li>
  </ol>
  <ul>
    <li>A. In London.</li>
    <li>B. I am twelve.</li>
  </ul>
</body>
</html>"""


class MockProvider:
    name = "mock"

    def complete_text(
        self,
        prompt: str,
        *,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        content = "Тип задания: Множественный выбор (Multiple choice)\nПредполагаемый класс: 5\nУровень сложности задания: 3"
        if "создать ещё один новый вариант" in prompt:
            if "Match the questions" in prompt:
                content = """<h2>Task 2</h2>
<p>Match the questions with the answers.</p>
<ol>
  <li>What is your favourite subject?</li>
  <li>When do you get up?</li>
</ol>
<ul>
  <li>A. At seven o'clock.</li>
  <li>B. English.</li>
</ul>"""
            else:
                content = """<h2>Task 1</h2>
<p>Choose the correct answer.</p>
<ol>
  <li>He ___ breakfast at seven yesterday.
    <ul><li>have</li><li>had</li><li>has</li></ul>
  </li>
  <li>We ___ English on Mondays.
    <ul><li>studies</li><li>study</li><li>studied</li></ul>
  </li>
</ol>"""
        if "итоговую оценку" in prompt and "эталонный учебный вариант" in prompt:
            content = "8"

        return LLMResponse(content=content, raw_response=content, provider=self.name, model=model or "mock-text-v1")

    def complete_with_file(
        self,
        prompt: str,
        *,
        file_path: str,
        mime_type: str,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        return LLMResponse(content=DEFAULT_HTML, raw_response=DEFAULT_HTML, provider=self.name, model=model or "mock-vision-v1")
