export type User = {
  id: string;
  email: string;
};

export type Assignment = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  image: AssignmentImage | null;
  latest_extraction_run: RunSummary | null;
};

export type AssignmentImage = {
  id: string;
  url: string;
  mime_type: string;
  size_bytes: number;
};

export type RunSummary = {
  id: string;
  status: string;
};

export type LLMProvider = 'gigachat' | 'openai';

export type ExtractionRun = {
  id: string;
  assignment_id: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'succeeded' | 'failed';
  current_step: number;
  provider?: string;
  model?: string;
  prompt_version?: string;
  parsed_content: PipelineContent | null;
  step_results: PipelineStepResult[];
  warnings: WarningEntry[];
  error_message?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
};

export type PipelineContent = {
  markdown?: string;
  parameters?: string;
  variation_rules?: string;
  variant_markdown?: string;
  steps: PipelineStepResult[];
};

export type PipelineStepResult = {
  step: number;
  key: string;
  title: string;
  content: string;
  created_at: string;
};

export type WarningEntry = {
  type: string;
  message: string;
};

export class APIError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
  }
}

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const isJSON = response.headers.get('Content-Type')?.includes('application/json');
  const body = isJSON ? ((await response.json()) as ErrorBody | T) : null;

  if (!response.ok) {
    const error = (body as ErrorBody | null)?.error;
    throw new APIError(
      error?.code ?? 'request_failed',
      error?.message ?? 'Не удалось выполнить запрос.',
      response.status,
    );
  }

  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/api/me'),
  createAssignment: (title: string) =>
    request<Assignment>('/api/assignments', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  uploadImage: (assignmentId: string, file: File) => {
    const formData = new FormData();
    formData.set('file', file);
    return request<{ assignment_id: string; image: AssignmentImage; status: string }>(
      `/api/assignments/${assignmentId}/image`,
      {
        method: 'POST',
        body: formData,
      },
    );
  },
  startExtraction: (assignmentId: string, provider?: LLMProvider) =>
    request<{ extraction_run_id: string; status: string; provider?: string }>(
      `/api/assignments/${assignmentId}/extract`,
      {
        method: 'POST',
        body: JSON.stringify(provider ? { llm_provider: provider } : {}),
      },
    ),
  getAssignment: (assignmentId: string) =>
    request<Assignment>(`/api/assignments/${assignmentId}`),
  getExtractionRun: (runId: string) =>
    request<ExtractionRun>(`/api/extraction-runs/${runId}`),
  continueExtractionRun: (runId: string, finalModel?: 'lite' | 'pro') =>
    request<{ extraction_run_id: string; status: string; next_step: number }>(
      `/api/extraction-runs/${runId}/continue`,
      {
        method: 'POST',
        body: JSON.stringify(finalModel ? { final_model: finalModel } : {}),
      },
    ),
  updateExtractionStep: (runId: string, step: number, content: string) =>
    request<ExtractionRun>(`/api/extraction-runs/${runId}/steps/${step}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  regenerateExtractionStep: (runId: string, step: number) =>
    request<{ extraction_run_id: string; status: string; step: number }>(
      `/api/extraction-runs/${runId}/steps/${step}/regenerate`,
      { method: 'POST' },
    ),
};

export function userMessage(error: unknown): string {
  if (error instanceof APIError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Произошла ошибка.';
}
