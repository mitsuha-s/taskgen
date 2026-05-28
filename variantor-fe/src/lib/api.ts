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
  files?: AssignmentImage[];
  latest_extraction_run: RunSummary | null;
};

export type AssignmentImage = {
  id: string;
  url: string;
  preview_url?: string;
  mime_type: string;
  size_bytes: number;
};

export type RunSummary = {
  id: string;
  status: string;
};

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
  source_html?: string;
  parameters?: string;
  variant_html?: string;
  variants_html?: string[];
  variants_expected?: number;
  answers_by_variant?: string[];
  answers_all?: string;
  selected_variant?: number;
  self_score?: string;
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

export type LLMSelection = {
  provider: string;
  model: string;
};

export type LLMModelOption = {
  id: string;
  label: string;
};

export type LLMProviderOption = {
  id: string;
  label: string;
  configured: boolean;
  default_model: string;
  models: LLMModelOption[];
};

export type LLMOptions = {
  default_provider: string;
  providers: LLMProviderOption[];
};

export type ExtractionOptions = {
  use_default_source?: boolean;
  manual_source_text?: string;
  step_provider?: string;
  step_model?: string;
  final_provider?: string;
  final_model?: string;
  evaluation_provider?: string;
  evaluation_model?: string;
  variant_count?: number;
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
  register: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/api/me'),
  getLLMOptions: () => request<LLMOptions>('/api/llm/options'),
  createAssignment: (title: string) =>
    request<Assignment>('/api/assignments', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  updateAssignmentTitle: (assignmentId: string, title: string) =>
    request<Assignment>(`/api/assignments/${assignmentId}`, {
      method: 'PUT',
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
  uploadFiles: (assignmentId: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    return request<{ assignment_id: string; files: AssignmentImage[]; status: string }>(
      `/api/assignments/${assignmentId}/files`,
      {
        method: 'POST',
        body: formData,
      },
    );
  },
  previewFilePdf: async (file: File) => {
    const formData = new FormData();
    formData.set('file', file);
    const response = await fetch('/api/files/preview.pdf', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const isJSON = response.headers.get('Content-Type')?.includes('application/json');
      const body = isJSON ? ((await response.json()) as ErrorBody) : null;
      const error = body?.error;
      throw new APIError(
        error?.code ?? 'request_failed',
        error?.message ?? 'Не удалось выполнить запрос.',
        response.status,
      );
    }
    return response.blob();
  },
  startExtraction: (assignmentId: string, options?: ExtractionOptions) =>
    request<{ extraction_run_id: string; status: string }>(
      `/api/assignments/${assignmentId}/extract`,
      { method: 'POST', body: JSON.stringify(options ?? {}) },
    ),
  getAssignment: (assignmentId: string) =>
    request<Assignment>(`/api/assignments/${assignmentId}`),
  listAssignments: () => request<{ assignments: Assignment[] }>('/api/assignments'),
  getExtractionRun: (runId: string) =>
    request<ExtractionRun>(`/api/extraction-runs/${runId}`),
  continueExtractionRun: (runId: string, options?: ExtractionOptions) =>
    request<{ extraction_run_id: string; status: string; next_step: number }>(
      `/api/extraction-runs/${runId}/continue`,
      {
        method: 'POST',
        body: JSON.stringify(options ?? {}),
      },
    ),
  updateExtractionStep: (runId: string, step: number, content: string) =>
    request<ExtractionRun>(`/api/extraction-runs/${runId}/steps/${step}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  regenerateExtractionStep: (runId: string, step: number, options?: ExtractionOptions) =>
    request<{ extraction_run_id: string; status: string; step: number }>(
      `/api/extraction-runs/${runId}/steps/${step}/regenerate`,
      { method: 'POST', body: JSON.stringify(options ?? {}) },
    ),
  regenerateVariant: (runId: string, variantIndex: number, options?: ExtractionOptions) =>
    request<{ extraction_run_id: string; status: string; variant_index: number }>(
      `/api/extraction-runs/${runId}/variants/${variantIndex}/regenerate`,
      { method: 'POST', body: JSON.stringify(options ?? {}) },
    ),
  updateVariant: (runId: string, variantIndex: number, content: string) =>
    request<ExtractionRun>(`/api/extraction-runs/${runId}/variants/${variantIndex}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
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
