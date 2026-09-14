import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:8001";

const IS_PRODUCTION = import.meta.env.PROD;

const ENVIRONMENT_LABEL =
  IS_PRODUCTION
    ? "Produção AWS"
    : "Ambiente local";

const AI_STATUS_LABEL =
  IS_PRODUCTION
    ? "Ylume AI · AWS Bedrock"
    : "Ylume AI · ambiente de desenvolvimento";



function apiFetch(
  url,
  options = {},
) {
  return fetch(
    url,
    {
      ...options,
      credentials: "include",
      headers: {
        ...(options.headers || {}),
      },
    },
  );
}


function createField() {
  return {
    id: crypto.randomUUID(),
    name: "",
    field_type: "text",
    description: "",
  };
}


function createDefaultFields() {
  return [
    {
      id: crypto.randomUUID(),
      name: "Categoria",
      field_type: "category",
      description:
        "Classificação principal do conteúdo.",
    },
    {
      id: crypto.randomUUID(),
      name: "Resumo",
      field_type: "text",
      description:
        "Síntese objetiva do conteúdo analisado.",
    },
  ];
}


function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(date);
}


function formatResultValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}



function formatDuration(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  const seconds =
    value / 1000;

  return `${seconds.toFixed(
    seconds >= 10 ? 1 : 2,
  )} s`;
}


function formatNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return new Intl.NumberFormat(
    "pt-BR",
    {
      maximumFractionDigits: 2,
    },
  ).format(value);
}


function fieldTypeLabel(value) {
  const labels = {
    text: "Texto",
    category: "Categoria",
    number: "Número",
    date: "Data",
    boolean: "Sim ou não",
  };

  return labels[value] || value;
}


function detectCsvDelimiter(text) {
  const firstLine =
    text
      .split(/\r?\n/)
      .find((line) =>
        line.trim(),
      ) || "";

  const candidates = [
    ";",
    ",",
    "\t",
  ];

  let bestDelimiter = ";";
  let bestCount = -1;

  for (const delimiter of candidates) {
    let count = 0;
    let insideQuotes = false;

    for (
      let index = 0;
      index < firstLine.length;
      index += 1
    ) {
      const character =
        firstLine[index];

      if (character === '"') {
        if (
          insideQuotes &&
          firstLine[index + 1] === '"'
        ) {
          index += 1;
        } else {
          insideQuotes =
            !insideQuotes;
        }
      } else if (
        !insideQuotes &&
        character === delimiter
      ) {
        count += 1;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}


function chooseDefaultCsvColumn(
  headers,
) {
  const preferredNames = [
    "mensagem",
    "texto",
    "conteudo",
    "conteúdo",
    "comentario",
    "comentário",
    "descricao",
    "descrição",
    "verbalizacao",
    "verbalização",
    "feedback",
    "message",
    "text",
    "content",
    "description",
  ];

  const normalizedHeaders =
    headers.map((header) => ({
      original: header,
      normalized: header
        .trim()
        .toLocaleLowerCase(
          "pt-BR",
        ),
    }));

  for (
    const preferred
    of preferredNames
  ) {
    const match =
      normalizedHeaders.find(
        (header) =>
          header.normalized ===
          preferred,
      );

    if (match) {
      return match.original;
    }
  }

  return headers[0] || "";
}


function looksLikeIdentifierColumn(
  columnName,
) {
  const normalized =
    String(columnName || "")
      .trim()
      .toLocaleLowerCase(
        "pt-BR",
      );

  return [
    "id",
    "codigo",
    "código",
    "code",
    "chave",
    "key",
    "numero",
    "número",
  ].includes(normalized);
}


function parseCsv(text) {
  const delimiter =
    detectCsvDelimiter(text);

  const rawRows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const character = text[index];

    if (character === '"') {
      if (
        insideQuotes &&
        text[index + 1] === '"'
      ) {
        cell += '"';
        index += 1;
      } else {
        insideQuotes =
          !insideQuotes;
      }
      continue;
    }

    if (
      character === delimiter &&
      !insideQuotes
    ) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (
      (character === "\n" ||
        character === "\r") &&
      !insideQuotes
    ) {
      if (
        character === "\r" &&
        text[index + 1] === "\n"
      ) {
        index += 1;
      }

      row.push(cell);

      if (
        row.some((value) =>
          value.trim(),
        )
      ) {
        rawRows.push(row);
      }

      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  row.push(cell);

  if (
    row.some((value) =>
      value.trim(),
    )
  ) {
    rawRows.push(row);
  }

  if (rawRows.length < 2) {
    throw new Error(
      "O CSV precisa ter cabeçalho e pelo menos uma linha de dados.",
    );
  }

  const headers = rawRows[0].map(
    (header, index) =>
      header.trim() ||
      `Coluna ${index + 1}`,
  );

  const rows = rawRows
    .slice(1)
    .map((values) => {
      const item = {};

      headers.forEach(
        (header, index) => {
          item[header] =
            values[index]?.trim() ||
            "";
        },
      );

      return item;
    })
    .filter((item) =>
      Object.values(item).some(
        (value) => value,
      ),
    );

  return {
    headers,
    rows,
    delimiter,
  };
}


function App() {
  const [
    authStatus,
    setAuthStatus,
  ] = useState("checking");

  const [user, setUser] =
    useState(null);

  const [
    authMode,
    setAuthMode,
  ] = useState("login");

  const [
    authForm,
    setAuthForm,
  ] = useState({
    display_name: "",
    email: "",
    password: "",
  });

  const [
    authMessage,
    setAuthMessage,
  ] = useState("");

  const [
    canClaimLocalProjects,
    setCanClaimLocalProjects,
  ] = useState(false);


  const [form, setForm] = useState({
    project_name: "",
    context: "",
    objective: "",
    sample_text: "",
  });

  const [fields, setFields] = useState(
    createDefaultFields,
  );

  const [projects, setProjects] =
    useState([]);

  const [
    historyStatus,
    setHistoryStatus,
  ] = useState("loading");

  const [
    selectedProjectId,
    setSelectedProjectId,
  ] = useState(null);

  const [result, setResult] =
    useState(null);

  const [status, setStatus] =
    useState("idle");

  const [error, setError] =
    useState("");

  const [executions, setExecutions] =
    useState([]);

  const [
    executionStatus,
    setExecutionStatus,
  ] = useState("idle");


  const [
    activeView,
    setActiveView,
  ] = useState("project");

  const [dashboard, setDashboard] =
    useState(null);

  const [
    dashboardStatus,
    setDashboardStatus,
  ] = useState("idle");


  const [batchFileName, setBatchFileName] =
    useState("");

  const [batchHeaders, setBatchHeaders] =
    useState([]);

  const [batchRows, setBatchRows] =
    useState([]);

  const [batchColumn, setBatchColumn] =
    useState("");

  const [batchStatus, setBatchStatus] =
    useState("idle");

  const [batchMessage, setBatchMessage] =
    useState("");

  const [batchResult, setBatchResult] =
    useState(null);


  const [dataset, setDataset] =
    useState(null);

  const [
    datasetStatus,
    setDatasetStatus,
  ] = useState("idle");

  const [
    datasetSearch,
    setDatasetSearch,
  ] = useState("");

  const [
    datasetFilter,
    setDatasetFilter,
  ] = useState("all");

  const [
    datasetSort,
    setDatasetSort,
  ] = useState("recent");

  const [
    exportStatus,
    setExportStatus,
  ] = useState("idle");

  const [
    datasetMessage,
    setDatasetMessage,
  ] = useState("");


  const [
    datasetActionStatus,
    setDatasetActionStatus,
  ] = useState("idle");


  // =========================================================
  // AUTENTICAÇÃO
  // =========================================================

  const loadCurrentUser =
    useCallback(async () => {
      try {
        setAuthStatus(
          "checking",
        );

        const response = await apiFetch(
          `${API_URL}/auth/me`,
        );

        if (
          response.status === 401
        ) {
          setUser(null);
          setAuthStatus(
            "unauthenticated",
          );
          return;
        }

        if (!response.ok) {
          throw new Error(
            "Não foi possível validar a sessão.",
          );
        }

        const data =
          await response.json();

        setUser(data);

        setCanClaimLocalProjects(
          Boolean(
            data.can_claim_local_projects,
          ),
        );

        setAuthStatus(
          "authenticated",
        );
      } catch (requestError) {
        console.error(
          "Erro ao validar sessão:",
          requestError,
        );

        setUser(null);
        setAuthStatus(
          "unauthenticated",
        );
      }
    }, []);


  function updateAuthForm(
    event,
  ) {
    const {
      name,
      value,
    } = event.target;

    setAuthForm(
      (current) => ({
        ...current,
        [name]: value,
      }),
    );
  }


  async function handleAuthSubmit(
    event,
  ) {
    event.preventDefault();

    try {
      setAuthStatus(
        "submitting",
      );
      setAuthMessage("");

      const endpoint =
        authMode === "register"
          ? "register"
          : "login";

      const payload =
        authMode === "register"
          ? {
              display_name:
                authForm
                  .display_name
                  .trim(),
              email:
                authForm.email
                  .trim(),
              password:
                authForm.password,
            }
          : {
              email:
                authForm.email
                  .trim(),
              password:
                authForm.password,
            };

      const response = await apiFetch(
        `${API_URL}/auth/${endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify(
              payload,
            ),
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        const detail =
          data?.detail;

        throw new Error(
          Array.isArray(detail)
            ? detail[0]?.msg
            : typeof detail ===
                "string"
              ? detail
              : "Não foi possível autenticar.",
        );
      }

      setUser(data);

      setCanClaimLocalProjects(
        Boolean(
          data.can_claim_local_projects,
        ),
      );

      setAuthForm({
        display_name: "",
        email: "",
        password: "",
      });

      setAuthStatus(
        "authenticated",
      );
    } catch (requestError) {
      console.error(
        "Erro de autenticação:",
        requestError,
      );

      setAuthMessage(
        requestError.message ||
          "Não foi possível autenticar.",
      );

      setAuthStatus(
        "unauthenticated",
      );
    }
  }


  async function handleLogout() {
    try {
      await apiFetch(
        `${API_URL}/auth/logout`,
        {
          method: "POST",
        },
      );
    } finally {
      setUser(null);
      setProjects([]);
      setSelectedProjectId(
        null,
      );
      setResult(null);
      setDashboard(null);
      setDataset(null);
      setExecutions([]);
      setAuthStatus(
        "unauthenticated",
      );
    }
  }


  async function handleClaimLocalProjects() {
    try {
      setAuthMessage("");

      const response = await apiFetch(
        `${API_URL}/auth/claim-local-projects`,
        {
          method: "POST",
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            "Não foi possível importar os projetos locais.",
        );
      }

      await loadProjects();

      window.alert(
        `${data.claimed_projects} projeto(s) local(is) vinculado(s) à sua conta.`,
      );
    } catch (requestError) {
      window.alert(
        requestError.message ||
          "Não foi possível importar os projetos.",
      );
    }
  }


  // =========================================================
  // HISTÓRICO
  // =========================================================

  const loadProjects =
    useCallback(async () => {
      try {
        setHistoryStatus("loading");

        const response = await apiFetch(
          `${API_URL}/projects`,
        );

        if (!response.ok) {
          throw new Error(
            "Não foi possível carregar o histórico.",
          );
        }

        const data =
          await response.json();

        setProjects(
          Array.isArray(data)
            ? data
            : [],
        );

        setHistoryStatus("success");
      } catch (requestError) {
        console.error(
          "Erro ao carregar projetos:",
          requestError,
        );

        setHistoryStatus("error");
      }
    }, []);


  const loadExecutions =
    useCallback(
      async (projectId) => {
        if (!projectId) {
          setExecutions([]);
          setExecutionStatus("idle");
          return;
        }

        try {
          setExecutionStatus("loading");

          const response = await apiFetch(
            `${API_URL}/projects/${projectId}/executions`,
          );

          if (!response.ok) {
            throw new Error(
              "Não foi possível carregar as execuções.",
            );
          }

          const data =
            await response.json();

          setExecutions(
            Array.isArray(data)
              ? data
              : [],
          );

          setExecutionStatus("success");
        } catch (requestError) {
          console.error(
            "Erro ao carregar execuções:",
            requestError,
          );

          setExecutionStatus("error");
        }
      },
      [],
    );


  const loadDashboard =
    useCallback(
      async (projectId) => {
        if (!projectId) {
          setDashboard(null);
          setDashboardStatus("idle");
          return;
        }

        try {
          setDashboardStatus("loading");

          const response = await apiFetch(
            `${API_URL}/projects/${projectId}/dashboard`,
          );

          if (!response.ok) {
            throw new Error(
              "Não foi possível carregar o dashboard.",
            );
          }

          const data =
            await response.json();

          setDashboard(data);
          setDashboardStatus("success");
        } catch (requestError) {
          console.error(
            "Erro ao carregar dashboard:",
            requestError,
          );

          setDashboard(null);
          setDashboardStatus("error");
        }
      },
      [],
    );


  const loadDataset =
    useCallback(
      async (projectId) => {
        if (!projectId) {
          setDataset(null);
          setDatasetStatus("idle");
          return;
        }

        try {
          setDatasetStatus("loading");
          setDatasetMessage("");

          const response = await apiFetch(
            `${API_URL}/projects/${projectId}/dataset`,
          );

          if (!response.ok) {
            throw new Error(
              "Não foi possível carregar o dataset.",
            );
          }

          const data =
            await response.json();

          setDataset(data);
          setDatasetStatus("success");
        } catch (requestError) {
          console.error(
            "Erro ao carregar dataset:",
            requestError,
          );

          setDataset(null);
          setDatasetStatus("error");
          setDatasetMessage(
            requestError.message ||
              "Não foi possível carregar o dataset.",
          );
        }
      },
      [],
    );


  function handleOpenDataset() {
    setActiveView("dataset");
    setResult(null);
    setError("");

    if (selectedProjectId) {
      loadDataset(
        selectedProjectId,
      );
    }
  }


  function handleOpenDashboard() {
    setActiveView("dashboard");
    setResult(null);
    setError("");

    if (selectedProjectId) {
      loadDashboard(
        selectedProjectId,
      );
    }
  }


  function navigateToSection(
    sectionId,
  ) {
    setActiveView("project");

    setTimeout(() => {
      document
        .getElementById(
          sectionId,
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 60);
  }


  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);


  useEffect(() => {
    if (
      authStatus ===
      "authenticated"
    ) {
      loadProjects();
    }
  }, [
    authStatus,
    loadProjects,
  ]);


  // =========================================================
  // CSV / PROCESSAMENTO EM LOTE
  // =========================================================

  async function handleCsvFile(
    event,
  ) {
    const file =
      event.target.files?.[0];

    setBatchResult(null);
    setBatchMessage("");

    if (!file) {
      setBatchFileName("");
      setBatchHeaders([]);
      setBatchRows([]);
      setBatchColumn("");
      setBatchStatus("idle");
      return;
    }

    try {
      setBatchStatus("reading");

      const text =
        await file.text();

      const parsed =
        parseCsv(text);

      setBatchFileName(
        file.name,
      );
      setBatchHeaders(
        parsed.headers,
      );
      setBatchRows(
        parsed.rows,
      );
      setBatchColumn(
        chooseDefaultCsvColumn(
          parsed.headers,
        ),
      );
      setBatchStatus("ready");

      if (parsed.rows.length > 25) {
        setBatchMessage(
          `CSV carregado com ${parsed.rows.length} linhas. Nesta versão, serão processadas as primeiras 25 linhas preenchidas da coluna escolhida.`,
        );
      } else {
        setBatchMessage(
          `CSV carregado com ${parsed.rows.length} linhas.`,
        );
      }
    } catch (requestError) {
      console.error(
        "Erro ao ler CSV:",
        requestError,
      );

      setBatchFileName("");
      setBatchHeaders([]);
      setBatchRows([]);
      setBatchColumn("");
      setBatchStatus("error");
      setBatchMessage(
        requestError.message ||
          "Não foi possível ler o CSV.",
      );
    }
  }


  async function handleBatchProcess() {
    if (!selectedProjectId) {
      setBatchStatus("error");
      setBatchMessage(
        "Abra um projeto salvo antes de processar um CSV.",
      );
      return;
    }

    if (!batchColumn) {
      setBatchStatus("error");
      setBatchMessage(
        "Escolha a coluna que contém o texto a ser analisado.",
      );
      return;
    }

    if (
      looksLikeIdentifierColumn(
        batchColumn,
      )
    ) {
      const confirmed =
        window.confirm(
          `A coluna "${batchColumn}" parece ser um identificador, não um texto.\n\nDeseja processá-la mesmo assim?`,
        );

      if (!confirmed) {
        setBatchStatus("ready");
        setBatchMessage(
          "Escolha uma coluna textual, como mensagem, texto ou descrição.",
        );
        return;
      }
    }

    const texts = batchRows
      .map((row) =>
        String(
          row[batchColumn] || "",
        ).trim(),
      )
      .filter(Boolean)
      .slice(0, 25);

    if (texts.length === 0) {
      setBatchStatus("error");
      setBatchMessage(
        "A coluna selecionada não possui textos preenchidos.",
      );
      return;
    }

    try {
      setBatchStatus("processing");
      setBatchMessage(
        `Processando ${texts.length} registros com a Ylume AI...`,
      );
      setBatchResult(null);

      const response = await apiFetch(
        `${API_URL}/projects/${selectedProjectId}/batch`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            texts,
            source_name:
              batchFileName || null,
          }),
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        const detail = data?.detail;

        throw new Error(
          typeof detail === "string"
            ? detail
            : detail?.message ||
                "Não foi possível processar o lote.",
        );
      }

      setBatchResult(data);
      setBatchStatus("success");
      setBatchMessage(
        `Lote concluído: ${data.successful_rows} com sucesso e ${data.failed_rows} com falha.`,
      );

      await loadExecutions(
        selectedProjectId,
      );

      setDashboard(null);
      setDashboardStatus("idle");
      setDataset(null);
      setDatasetStatus("idle");
    } catch (requestError) {
      console.error(
        "Erro no lote:",
        requestError,
      );

      setBatchStatus("error");
      setBatchMessage(
        requestError.message ||
          "Não foi possível processar o CSV.",
      );
    }
  }


  // =========================================================
  // DATASET / EXPORTAÇÃO
  // =========================================================

  async function handleExport(
    format,
  ) {
    if (!selectedProjectId) {
      return;
    }

    try {
      setExportStatus(format);
      setDatasetMessage("");

      const response = await apiFetch(
        `${API_URL}/projects/${selectedProjectId}/export/${format}`,
      );

      if (!response.ok) {
        let message =
          "Não foi possível exportar o dataset.";

        try {
          const data =
            await response.json();

          if (data?.detail) {
            message =
              typeof data.detail ===
                "string"
                ? data.detail
                : JSON.stringify(
                    data.detail,
                  );
          }
        } catch {
          // Mantém a mensagem padrão.
        }

        throw new Error(
          message,
        );
      }

      const blob =
        await response.blob();

      const disposition =
        response.headers.get(
          "content-disposition",
        );

      const match =
        disposition?.match(
          /filename="([^"]+)"/i,
        );

      const extension =
        format === "xlsx"
          ? "xlsx"
          : format;

      const filename =
        match?.[1] ||
        `ylume_dataset.${extension}`;

      const url =
        URL.createObjectURL(
          blob,
        );

      const anchor =
        document.createElement(
          "a",
        );

      anchor.href = url;
      anchor.download = filename;

      document.body.appendChild(
        anchor,
      );

      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(
        url,
      );

      setDatasetMessage(
        `Exportação ${format.toUpperCase()} concluída.`,
      );
    } catch (requestError) {
      console.error(
        "Erro ao exportar dataset:",
        requestError,
      );

      setDatasetMessage(
        requestError.message ||
          "Não foi possível exportar o dataset.",
      );
    } finally {
      setExportStatus("idle");
    }
  }


  async function handleDeleteExecution(
    executionId,
  ) {
    const confirmed =
      window.confirm(
        `Excluir a execução #${executionId}?\n\n` +
          "Ela será removida do histórico, dataset e dashboard.",
      );

    if (!confirmed) {
      return;
    }

    try {
      setDatasetMessage("");

      const response = await apiFetch(
        `${API_URL}/executions/${executionId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        let message =
          "Não foi possível excluir a execução.";

        try {
          const data =
            await response.json();

          if (data?.detail) {
            message =
              typeof data.detail ===
                "string"
                ? data.detail
                : JSON.stringify(
                    data.detail,
                  );
          }
        } catch {
          // Mantém a mensagem padrão.
        }

        throw new Error(
          message,
        );
      }

      if (
        result?.execution?.id ===
        executionId
      ) {
        setResult(null);
      }

      await loadExecutions(
        selectedProjectId,
      );

      if (
        activeView === "dataset"
      ) {
        await loadDataset(
          selectedProjectId,
        );
      } else {
        setDataset(null);
        setDatasetStatus("idle");
      }

      setDashboard(null);
      setDashboardStatus("idle");

      setDatasetMessage(
        `Execução #${executionId} excluída.`,
      );
    } catch (requestError) {
      console.error(
        "Erro ao excluir execução:",
        requestError,
      );

      setDatasetMessage(
        requestError.message ||
          "Não foi possível excluir a execução.",
      );
    }
  }


  async function handleClearProjectExecutions() {
    if (!selectedProjectId) {
      return;
    }

    const confirmed =
      window.confirm(
        "Excluir TODAS as execuções deste projeto?\n\n" +
          "O projeto e seu schema serão mantidos, mas histórico, dataset e dashboard ficarão vazios.",
      );

    if (!confirmed) {
      return;
    }

    const secondConfirmation =
      window.confirm(
        "Confirma a limpeza completa das execuções? Esta ação não pode ser desfeita.",
      );

    if (!secondConfirmation) {
      return;
    }

    try {
      setDatasetActionStatus(
        "clearing",
      );
      setDatasetMessage("");

      const response = await apiFetch(
        `${API_URL}/projects/${selectedProjectId}/executions`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        let message =
          "Não foi possível limpar as execuções.";

        try {
          const data =
            await response.json();

          if (data?.detail) {
            message =
              typeof data.detail ===
                "string"
                ? data.detail
                : JSON.stringify(
                    data.detail,
                  );
          }
        } catch {
          // Mantém a mensagem padrão.
        }

        throw new Error(
          message,
        );
      }

      setResult(null);
      setExecutions([]);
      setDashboard(null);
      setDashboardStatus("idle");

      await loadDataset(
        selectedProjectId,
      );

      setDatasetMessage(
        "Todas as execuções do projeto foram removidas.",
      );
    } catch (requestError) {
      console.error(
        "Erro ao limpar execuções:",
        requestError,
      );

      setDatasetMessage(
        requestError.message ||
          "Não foi possível limpar as execuções.",
      );
    } finally {
      setDatasetActionStatus(
        "idle",
      );
    }
  }


  const visibleDatasetRows =
    useMemo(() => {
      const rows =
        dataset?.rows
          ? [...dataset.rows]
          : [];

      const search =
        datasetSearch
          .trim()
          .toLocaleLowerCase(
            "pt-BR",
          );

      const filtered = rows.filter(
        (row) => {
          if (
            datasetFilter ===
              "success" &&
            !row.success
          ) {
            return false;
          }

          if (
            datasetFilter ===
              "failed" &&
            row.success
          ) {
            return false;
          }

          if (!search) {
            return true;
          }

          const searchable =
            [
              row.execution_id,
              row.source_text,
              row.provider,
              row.success
                ? "sucesso"
                : "falha",
              ...Object.values(
                row.values || {},
              ),
            ]
              .map((value) =>
                value === null ||
                value === undefined
                  ? ""
                  : typeof value ===
                      "object"
                    ? JSON.stringify(
                        value,
                      )
                    : String(value),
              )
              .join(" ")
              .toLocaleLowerCase(
                "pt-BR",
              );

          return searchable.includes(
            search,
          );
        },
      );

      filtered.sort(
        (first, second) => {
          if (
            datasetSort ===
            "oldest"
          ) {
            return (
              new Date(
                first.processed_at,
              ) -
              new Date(
                second.processed_at,
              )
            );
          }

          if (
            datasetSort ===
            "id-asc"
          ) {
            return (
              first.execution_id -
              second.execution_id
            );
          }

          if (
            datasetSort ===
            "id-desc"
          ) {
            return (
              second.execution_id -
              first.execution_id
            );
          }

          return (
            new Date(
              second.processed_at,
            ) -
            new Date(
              first.processed_at,
            )
          );
        },
      );

      return filtered;
    }, [
      dataset,
      datasetSearch,
      datasetFilter,
      datasetSort,
    ]);


  // =========================================================
  // FORMULÁRIO
  // =========================================================

  function updateForm(event) {
    const {
      name,
      value,
    } = event.target;

    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }


  function updateField(
    fieldId,
    property,
    value,
  ) {
    setFields((currentFields) =>
      currentFields.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              [property]: value,
            }
          : field,
      ),
    );
  }


  function addField() {
    setFields((currentFields) => [
      ...currentFields,
      createField(),
    ]);
  }


  function removeField(fieldId) {
    setFields((currentFields) =>
      currentFields.filter(
        (field) =>
          field.id !== fieldId,
      ),
    );
  }


  // =========================================================
  // NOVO PROJETO
  // =========================================================

  function handleNewProject() {
    setSelectedProjectId(null);

    setForm({
      project_name: "",
      context: "",
      objective: "",
      sample_text: "",
    });

    setFields(
      createDefaultFields(),
    );

    setResult(null);
    setError("");
    setStatus("idle");
    setExecutions([]);
    setExecutionStatus("idle");
    setDashboard(null);
    setDashboardStatus("idle");
    setDataset(null);
    setDatasetStatus("idle");
    setDatasetSearch("");
    setDatasetFilter("all");
    setDatasetSort("recent");
    setDatasetMessage("");
    setActiveView("project");
    setBatchFileName("");
    setBatchHeaders([]);
    setBatchRows([]);
    setBatchColumn("");
    setBatchStatus("idle");
    setBatchMessage("");
    setBatchResult(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }


  // =========================================================
  // ABRIR PROJETO
  // =========================================================

  function handleLoadProject(project) {
    setSelectedProjectId(
      project.id,
    );

    setForm({
      project_name:
        project.name || "",
      context:
        project.context || "",
      objective:
        project.objective || "",
      sample_text: "",
    });

    const projectFields =
      Array.isArray(project.fields)
        ? [...project.fields]
        : [];

    setFields(
      projectFields.length > 0
        ? projectFields
            .sort(
              (
                firstField,
                secondField,
              ) =>
                firstField.position -
                secondField.position,
            )
            .map((field) => ({
              id:
                crypto.randomUUID(),

              name:
                field.name,

              field_type:
                field.field_type,

              description:
                field.description || "",
            }))
        : createDefaultFields(),
    );

    setResult(null);
    setError("");
    setStatus("idle");
    setDashboard(null);
    setDashboardStatus("idle");
    setDataset(null);
    setDatasetStatus("idle");
    setDatasetSearch("");
    setDatasetFilter("all");
    setDatasetSort("recent");
    setDatasetMessage("");
    setActiveView("project");
    setBatchFileName("");
    setBatchHeaders([]);
    setBatchRows([]);
    setBatchColumn("");
    setBatchStatus("idle");
    setBatchMessage("");
    setBatchResult(null);

    loadExecutions(
      project.id,
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }


  // =========================================================
  // EXCLUIR PROJETO
  // =========================================================

  async function handleDeleteProject(
    project,
  ) {
    const confirmed =
      window.confirm(
        `Excluir "${project.name}"?\n\n` +
          "Esta ação removerá o projeto e seus campos permanentemente.",
      );

    if (!confirmed) {
      return;
    }

    try {
      setError("");

      const response = await apiFetch(
        `${API_URL}/projects/${project.id}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        let message =
          "Não foi possível excluir o projeto.";

        try {
          const data =
            await response.json();

          if (data?.detail) {
            message =
              typeof data.detail ===
              "string"
                ? data.detail
                : JSON.stringify(
                    data.detail,
                  );
          }
        } catch {
          // Mantém a mensagem padrão.
        }

        throw new Error(message);
      }

      if (
        selectedProjectId ===
        project.id
      ) {
        handleNewProject();
      }

      await loadProjects();
    } catch (requestError) {
      console.error(
        "Erro ao excluir projeto:",
        requestError,
      );

      setError(
        requestError.message ||
          "Não foi possível excluir o projeto.",
      );
    }
  }


  // =========================================================
  // VISUALIZAR EXECUÇÃO SALVA
  // =========================================================

  function handleViewExecution(
    execution,
  ) {
    setActiveView("project");

    setResult({
      success:
        execution.success,

      provider:
        execution.provider,

      project_name:
        form.project_name,

      structured_data:
        execution.structured_data,

      source_text:
        execution.source_text,

      processed_at:
        execution.processed_at,

      status:
        "saved_execution",

      execution: {
        id:
          execution.id,

        project_id:
          execution.project_id,

        duration_ms:
          execution.duration_ms,

        processed_at:
          execution.processed_at,
      },

      saved_project: {
        id:
          selectedProjectId,

        name:
          form.project_name,
      },
    });

    setTimeout(() => {
      document
        .getElementById(
          "result-section",
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 100);
  }


  // =========================================================
  // SALVAR / ATUALIZAR / PROCESSAR
  // =========================================================

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.sample_text.trim()) {
      setStatus("error");
      setError(
        "Informe um conteúdo não estruturado para processar individualmente.",
      );

      document
        .querySelector('textarea[name="sample_text"]')
        ?.focus();

      return;
    }

    setStatus("loading");
    setError("");
    setResult(null);

    const validFields = fields
      .filter(
        (field) =>
          field.name.trim(),
      )
      .map(
        ({
          id,
          ...field
        }) => ({
          ...field,

          name:
            field.name.trim(),

          description:
            field.description.trim() ||
            null,
        }),
      );

    if (
      validFields.length === 0
    ) {
      setStatus("error");

      setError(
        "Adicione pelo menos um campo de saída.",
      );

      return;
    }


    const projectPayload = {
      project_name:
        form.project_name.trim(),

      context:
        form.context.trim(),

      objective:
        form.objective.trim(),

      fields:
        validFields,
    };


    try {
      // -----------------------------------------------------
      // SALVA OU ATUALIZA O PROJETO
      // -----------------------------------------------------

      const projectUrl =
        selectedProjectId
          ? `${API_URL}/projects/${selectedProjectId}`
          : `${API_URL}/projects`;

      const projectMethod =
        selectedProjectId
          ? "PUT"
          : "POST";


      const projectResponse =
        await apiFetch(
          projectUrl,
          {
            method:
              projectMethod,

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                projectPayload,
              ),
          },
        );


      const projectData =
        await projectResponse.json();


      if (!projectResponse.ok) {
        const detail =
          projectData?.detail;

        const message =
          Array.isArray(detail)
            ? detail[0]?.msg
            : detail;

        throw new Error(
          message ||
            "Não foi possível salvar o projeto.",
        );
      }


      // -----------------------------------------------------
      // PROCESSAMENTO COM N8N + AWS BEDROCK
      // -----------------------------------------------------

      const previewResponse =
        await apiFetch(
          `${API_URL}/projects/preview`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                ...projectPayload,

                project_id:
                  projectData.id,

                sample_text:
                  form.sample_text.trim(),
              }),
          },
        );


      const previewData =
        await previewResponse.json();


      if (!previewResponse.ok) {
        const detail =
          previewData?.detail;

        let message;

        if (Array.isArray(detail)) {
          message =
            detail[0]?.msg;
        } else if (
          detail &&
          typeof detail ===
            "object"
        ) {
          message =
            detail.message ||
            JSON.stringify(
              detail,
            );
        } else {
          message =
            detail;
        }

        throw new Error(
          message ||
            "O projeto foi salvo, mas não pôde ser processado.",
        );
      }


      const completeResult = {
        ...previewData,

        saved_project: {
          id:
            projectData.id,

          name:
            projectData.name,

          created_at:
            projectData.created_at,
        },
      };


      setResult(
        completeResult,
      );

      setSelectedProjectId(
        projectData.id,
      );

      setStatus("success");

      await loadProjects();

      await loadExecutions(
        projectData.id,
      );

      setDashboard(null);
      setDashboardStatus("idle");
      setDataset(null);
      setDatasetStatus("idle");


      setTimeout(() => {
        document
          .getElementById(
            "result-section",
          )
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);

    } catch (requestError) {
      console.error(
        "Erro ao processar projeto:",
        requestError,
      );

      setStatus("error");

      setError(
        requestError.message ||
          "Não foi possível conectar à API da Ylume.",
      );

      if (selectedProjectId) {
        await loadExecutions(
          selectedProjectId,
        );

        setDashboard(null);
        setDashboardStatus("idle");
        setDataset(null);
        setDatasetStatus("idle");
      }
    }
  }


  // =========================================================
  // INTERFACE
  // =========================================================

  if (
    authStatus === "checking"
  ) {
    return (
      <main className="app-shell app-shell--friendly">
        <section className="auth-page auth-page--loading">
          <div className="auth-loading">
            <div className="brand__logo">
              Y
            </div>

            <strong>
              Ylume
            </strong>

            <span>
              Validando sessão...
            </span>
          </div>
        </section>
      </main>
    );
  }


  if (
    authStatus ===
      "unauthenticated" ||
    authStatus === "submitting"
  ) {
    return (
      <main className="app-shell app-shell--friendly">
        <section className="auth-page">
          <div className="auth-visual">
            <div className="auth-brand">
              <div className="brand__logo">
                Y
              </div>

              <div>
                <strong>
                  Ylume
                </strong>

                <span>
                  Data Structuring Platform
                </span>
              </div>
            </div>

            <div className="auth-copy">
              <p className="eyebrow">
                YLUME PLATFORM
              </p>

              <h1>
                Seus dados.
                <br />
                Seu espaço.
              </h1>

              <p>
                Entre para acessar seus
                projetos, execuções,
                dashboards e datasets de
                forma isolada e segura.
              </p>

              <div className="auth-security-note">
                <span>●</span>

                Sessão protegida · projetos
                vinculados à sua conta
              </div>
            </div>
          </div>


          <div className="auth-form-side">
            <div className="auth-card">
              <div className="auth-card__heading">
                <p className="eyebrow">
                  {authMode ===
                  "register"
                    ? "CRIAR CONTA"
                    : "BEM-VINDA"}
                </p>

                <h2>
                  {authMode ===
                  "register"
                    ? "Comece na Ylume."
                    : "Entre na Ylume."}
                </h2>

                <p>
                  {authMode ===
                  "register"
                    ? "Crie seu acesso para começar a organizar seus projetos."
                    : "Use seu e-mail e senha para continuar."}
                </p>
              </div>


              <form
                className="auth-form"
                onSubmit={
                  handleAuthSubmit
                }
              >
                {authMode ===
                  "register" && (
                  <label>
                    Nome

                    <input
                      type="text"
                      name="display_name"
                      value={
                        authForm
                          .display_name
                      }
                      onChange={
                        updateAuthForm
                      }
                      placeholder="Como devemos chamar você?"
                      minLength={2}
                      maxLength={120}
                      required
                    />
                  </label>
                )}


                <label>
                  E-mail

                  <input
                    type="email"
                    name="email"
                    value={
                      authForm.email
                    }
                    onChange={
                      updateAuthForm
                    }
                    placeholder="voce@exemplo.com"
                    autoComplete="email"
                    required
                  />
                </label>


                <label>
                  Senha

                  <input
                    type="password"
                    name="password"
                    value={
                      authForm.password
                    }
                    onChange={
                      updateAuthForm
                    }
                    placeholder={
                      authMode ===
                      "register"
                        ? "Mínimo de 10 caracteres"
                        : "Sua senha"
                    }
                    minLength={
                      authMode ===
                      "register"
                        ? 10
                        : 1
                    }
                    maxLength={128}
                    autoComplete={
                      authMode ===
                      "register"
                        ? "new-password"
                        : "current-password"
                    }
                    required
                  />
                </label>


                {authMessage && (
                  <div className="auth-error">
                    {authMessage}
                  </div>
                )}


                <button
                  type="submit"
                  className="primary-button auth-submit"
                  disabled={
                    authStatus ===
                    "submitting"
                  }
                >
                  {authStatus ===
                  "submitting"
                    ? "Aguarde..."
                    : authMode ===
                        "register"
                      ? "Criar conta"
                      : "Entrar"}
                </button>
              </form>


              <button
                type="button"
                className="auth-switch"
                onClick={() => {
                  setAuthMessage("");

                  setAuthMode(
                    authMode ===
                    "register"
                      ? "login"
                      : "register",
                  );
                }}
              >
                {authMode ===
                "register"
                  ? "Já possui uma conta? Entrar"
                  : "Ainda não possui conta? Criar acesso"}
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }


  return (
    <main className="app-shell app-shell--friendly">
      {/* ===================================================
          HEADER
      =================================================== */}

      <header className="topbar">
        <div className="brand">
          <div className="brand__logo">
            Y
          </div>

          <div>
            <strong>
              Ylume
            </strong>

            <span>
              Data Structuring Platform
            </span>
          </div>
        </div>

        <div className="topbar__account">
          <div className="environment">
            <span />

            {ENVIRONMENT_LABEL}
          </div>

          <div className="user-chip">
            <div className="user-chip__avatar">
              {user?.display_name
                ?.trim()
                ?.charAt(0)
                ?.toUpperCase() ||
                "Y"}
            </div>

            <div className="user-chip__identity">
              <strong>
                {
                  user?.display_name
                }
              </strong>

              <span>
                {user?.email}
              </span>
            </div>

            <button
              type="button"
              onClick={
                handleLogout
              }
            >
              Sair
            </button>
          </div>
        </div>
      </header>


      <div className="workspace">
        {/* =================================================
            SIDEBAR
        ================================================= */}

        <aside className="sidebar">
          <div className="sidebar__new-project">
            <button
              type="button"
              className="new-project-button"
              onClick={
                handleNewProject
              }
            >
              + Novo projeto
            </button>
          </div>


          {canClaimLocalProjects && (
            <button
              type="button"
              className="claim-projects-button"
              onClick={
                handleClaimLocalProjects
              }
            >
              Importar projetos locais
            </button>
          )}


          <p className="sidebar__label">
            NAVEGAÇÃO
          </p>


          <button
            type="button"
            className={`sidebar__item ${
              activeView === "project"
                ? "sidebar__item--active"
                : ""
            }`}
            onClick={() =>
              navigateToSection(
                "context-section",
              )
            }
          >
            01. Contexto
          </button>


          <button
            type="button"
            className="sidebar__item"
            onClick={() =>
              navigateToSection(
                "structure-section",
              )
            }
          >
            02. Estrutura
          </button>


          <button
            type="button"
            className="sidebar__item"
            onClick={() =>
              navigateToSection(
                "processing-section",
              )
            }
          >
            03. Processamento
          </button>


          <button
            type="button"
            className={`sidebar__item ${
              activeView === "dashboard"
                ? "sidebar__item--active"
                : ""
            }`}
            onClick={
              handleOpenDashboard
            }
          >
            04. Dashboard
          </button>


          <button
            type="button"
            className={`sidebar__item ${
              activeView === "dataset"
                ? "sidebar__item--active"
                : ""
            }`}
            onClick={
              handleOpenDataset
            }
          >
            05. Dataset
          </button>


          {/* ===============================================
              HISTÓRICO
          =============================================== */}

          <div className="sidebar__history">
            <div className="sidebar__history-heading">
              <p className="sidebar__label">
                HISTÓRICO
              </p>

              <button
                type="button"
                className="history-refresh"
                onClick={
                  loadProjects
                }
                title="Atualizar histórico"
              >
                ↻
              </button>
            </div>


            {historyStatus ===
              "loading" && (
              <p className="history-message">
                Carregando projetos...
              </p>
            )}


            {historyStatus ===
              "error" && (
              <p className="history-message">
                Não foi possível carregar.
              </p>
            )}


            {historyStatus ===
              "success" &&
              projects.length ===
                0 && (
                <p className="history-message">
                  Nenhum projeto salvo.
                </p>
              )}


            <div className="history-list">
              {projects.map(
                (project) => (
                  <div
                    key={
                      project.id
                    }
                    className={`history-card ${
                      selectedProjectId ===
                      project.id
                        ? "history-card--active"
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="history-card__content"
                      onClick={() =>
                        handleLoadProject(
                          project,
                        )
                      }
                    >
                      <span className="history-card__name">
                        {
                          project.name
                        }
                      </span>

                      <span className="history-card__meta">
                        ID{" "}
                        {
                          project.id
                        }{" "}
                        ·{" "}
                        {formatDate(
                          project.created_at,
                        )}
                      </span>
                    </button>


                    <div className="history-card__actions">
                      <button
                        type="button"
                        className="history-open-button"
                        onClick={() =>
                          handleLoadProject(
                            project,
                          )
                        }
                      >
                        Abrir
                      </button>


                      <button
                        type="button"
                        className="history-delete-button"
                        onClick={() =>
                          handleDeleteProject(
                            project,
                          )
                        }
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>


          {/* ===============================================
              RESEARCH
          =============================================== */}

          <div className="sidebar__research">
            <span>
              Research foundation
            </span>

            <p>
              Plataforma inspirada no
              estudo sobre estruturação
              e categorização de dados
              textuais com inteligência
              artificial.
            </p>
          </div>
        </aside>


        {/* =================================================
            CONTEÚDO PRINCIPAL
        ================================================= */}

        <section className="content">
          {activeView === "project" && (
            <>
          <div className="content__heading">
            <div>
              <p className="eyebrow">
                {selectedProjectId
                  ? "PROJETO CARREGADO"
                  : "NOVO PROJETO"}
              </p>

              <h1>
                Ensine a Ylume a
                compreender seus dados.
              </h1>

              <p>
                Defina o contexto, o
                objetivo e a estrutura
                que deseja obter a
                partir do conteúdo não
                estruturado.
              </p>
            </div>


            <div className="step-counter">
              Ylume AI
            </div>
          </div>


          {selectedProjectId &&
            !result && (
              <div className="loaded-project-message">
                Projeto ID{" "}
                <strong>
                  {
                    selectedProjectId
                  }
                </strong>{" "}
                carregado do
                histórico. Adicione um
                novo texto para
                processá-lo novamente.
              </div>
            )}


          {selectedProjectId && (
            <section className="execution-panel">
              <div className="execution-panel__heading">
                <div>
                  <p className="eyebrow">
                    EXECUÇÕES
                  </p>

                  <h2>
                    Histórico de processamentos
                  </h2>

                  <p>
                    Cada uso da Ylume AI neste projeto
                    fica registrado para consulta e
                    auditoria.
                  </p>
                </div>

                <span className="execution-count">
                  {executions.length}{" "}
                  {executions.length === 1
                    ? "execução"
                    : "execuções"}
                </span>
              </div>

              {executionStatus ===
                "loading" && (
                <p className="execution-message">
                  Carregando execuções...
                </p>
              )}

              {executionStatus ===
                "error" && (
                <p className="execution-message execution-message--error">
                  Não foi possível carregar
                  as execuções.
                </p>
              )}

              {executionStatus ===
                "success" &&
                executions.length ===
                  0 && (
                  <p className="execution-message">
                    Este projeto ainda não possui
                    processamentos salvos.
                  </p>
                )}

              {executions.length > 0 && (
                <div className="execution-list">
                  {executions.map(
                    (execution) => (
                      <article
                        className="execution-card"
                        key={
                          execution.id
                        }
                      >
                        <div className="execution-card__top">
                          <div>
                            <strong>
                              Execução #
                              {
                                execution.id
                              }
                            </strong>

                            <span>
                              {formatDate(
                                execution.processed_at,
                              )}
                            </span>
                          </div>

                          <span className="execution-provider">
                            {
                              execution.provider
                            }
                          </span>
                        </div>

                        <p className="execution-card__source">
                          {
                            execution.source_text
                          }
                        </p>

                        <div className="execution-card__footer">
                          <span>
                            {execution.duration_ms ??
                              "—"}{" "}
                            ms
                          </span>

                          <div className="execution-card__buttons">
                            <button
                              type="button"
                              onClick={() =>
                                handleViewExecution(
                                  execution,
                                )
                              }
                            >
                              Ver resultado
                            </button>

                            <button
                              type="button"
                              className="execution-delete-button"
                              onClick={() =>
                                handleDeleteExecution(
                                  execution.id,
                                )
                              }
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              )}
            </section>
          )}


          {/* ===============================================
              FORMULÁRIO
          =============================================== */}

          <form
            className="project-form"
            onSubmit={
              handleSubmit
            }
          >
            {/* CONTEXTO */}

            <section className="panel" id="context-section">
              <div className="panel__heading">
                <span className="panel__number">
                  01
                </span>

                <div>
                  <h2>
                    Contexto do projeto
                  </h2>

                  <p>
                    Explique o que
                    representam os
                    dados que serão
                    analisados.
                  </p>
                </div>
              </div>


              <label>
                Nome do projeto

                <input
                  type="text"
                  name="project_name"
                  value={
                    form.project_name
                  }
                  onChange={
                    updateForm
                  }
                  placeholder="Ex.: Análise de registros operacionais"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>


              <label>
                Contexto dos dados

                <textarea
                  name="context"
                  value={
                    form.context
                  }
                  onChange={
                    updateForm
                  }
                  placeholder="Ex.: Os registros são descrições textuais de ocorrências operacionais..."
                  rows={5}
                  minLength={5}
                  maxLength={3000}
                  required
                />
              </label>


              <label>
                Objetivo da transformação

                <textarea
                  name="objective"
                  value={
                    form.objective
                  }
                  onChange={
                    updateForm
                  }
                  placeholder="Ex.: Identificar tema, prioridade, área responsável e gerar um resumo..."
                  rows={4}
                  minLength={5}
                  maxLength={2000}
                  required
                />
              </label>
            </section>


            {/* ESTRUTURA */}

            <section className="panel" id="structure-section">
              <div className="panel__heading">
                <span className="panel__number">
                  02
                </span>

                <div>
                  <h2>
                    Estrutura de saída
                  </h2>

                  <p>
                    Defina quais
                    colunas deverão
                    existir na base
                    estruturada.
                  </p>
                </div>
              </div>


              <div className="field-list">
                {fields.map(
                  (
                    field,
                    index,
                  ) => (
                    <div
                      className="field-card"
                      key={
                        field.id
                      }
                    >
                      <div className="field-card__top">
                        <span>
                          Campo{" "}
                          {index +
                            1}
                        </span>

                        {fields.length >
                          1 && (
                          <button
                            type="button"
                            className="remove-button"
                            onClick={() =>
                              removeField(
                                field.id,
                              )
                            }
                          >
                            Remover
                          </button>
                        )}
                      </div>


                      <div className="field-grid">
                        <label>
                          Nome

                          <input
                            type="text"
                            value={
                              field.name
                            }
                            onChange={(
                              event,
                            ) =>
                              updateField(
                                field.id,
                                "name",
                                event
                                  .target
                                  .value,
                              )
                            }
                            placeholder="Ex.: Prioridade"
                            maxLength={
                              80
                            }
                          />
                        </label>


                        <label>
                          Tipo

                          <select
                            value={
                              field.field_type
                            }
                            onChange={(
                              event,
                            ) =>
                              updateField(
                                field.id,
                                "field_type",
                                event
                                  .target
                                  .value,
                              )
                            }
                          >
                            <option value="text">
                              Texto
                            </option>

                            <option value="category">
                              Categoria
                            </option>

                            <option value="number">
                              Número
                            </option>

                            <option value="date">
                              Data
                            </option>

                            <option value="boolean">
                              Sim ou não
                            </option>
                          </select>
                        </label>
                      </div>


                      <label>
                        Orientação para a IA

                        <input
                          type="text"
                          value={
                            field.description
                          }
                          onChange={(
                            event,
                          ) =>
                            updateField(
                              field.id,
                              "description",
                              event
                                .target
                                .value,
                            )
                          }
                          placeholder="Explique o que deve ser identificado neste campo."
                          maxLength={
                            300
                          }
                        />
                      </label>
                    </div>
                  ),
                )}
              </div>


              <button
                type="button"
                className="secondary-button"
                onClick={
                  addField
                }
              >
                + Adicionar campo
              </button>
            </section>


            {/* PROCESSAMENTO */}

            <section className="panel" id="processing-section">
              <div className="panel__heading">
                <span className="panel__number">
                  03
                </span>

                <div>
                  <h2>
                    Conteúdo para
                    processar
                  </h2>

                  <p>
                    A Ylume utiliza
                    inteligência
                    artificial para
                    transformar o
                    registro em dados
                    estruturados.
                  </p>
                </div>
              </div>


              <label>
                Conteúdo não estruturado

                <textarea
                  name="sample_text"
                  value={
                    form.sample_text
                  }
                  onChange={
                    updateForm
                  }
                  placeholder="Cole aqui um texto, descrição, mensagem ou registro..."
                  rows={7}
                  maxLength={10000}
                  
                />
              </label>


              <div className="batch-divider">
                <span>OU</span>
              </div>


              <div className="batch-box">
                <div className="batch-box__heading">
                  <div>
                    <span className="batch-badge">
                      CSV · LOTE
                    </span>

                    <h3>
                      Processar vários registros
                    </h3>

                    <p>
                      Importe um CSV, escolha a coluna
                      que contém o texto e a Ylume cria
                      uma execução para cada registro.
                    </p>
                  </div>

                  <span className="batch-limit">
                    até 25 linhas · IA
                  </span>
                </div>


                {!selectedProjectId && (
                  <div className="batch-note">
                    Salve ou abra um projeto antes de
                    iniciar o processamento em lote.
                  </div>
                )}


                <label className="batch-file">
                  Arquivo CSV

                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={
                      handleCsvFile
                    }
                  />
                </label>


                {batchFileName && (
                  <div className="batch-file-info">
                    <strong>
                      {batchFileName}
                    </strong>

                    <span>
                      {batchRows.length} linhas · {batchHeaders.length} colunas
                    </span>
                  </div>
                )}


                {batchHeaders.length > 0 && (
                  <div className="batch-controls">
                    <label>
                      Coluna para analisar

                      <select
                        value={
                          batchColumn
                        }
                        onChange={(event) =>
                          setBatchColumn(
                            event.target.value,
                          )
                        }
                      >
                        {batchHeaders.map(
                          (header) => (
                            <option
                              value={header}
                              key={header}
                            >
                              {header}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    {looksLikeIdentifierColumn(
                      batchColumn,
                    ) && (
                      <div className="batch-column-warning">
                        ⚠ A coluna selecionada parece
                        um identificador. Para análise
                        textual, prefira mensagem,
                        texto ou descrição.
                      </div>
                    )}


                    <button
                      type="button"
                      className="batch-process-button"
                      onClick={
                        handleBatchProcess
                      }
                      disabled={
                        !selectedProjectId ||
                        batchStatus ===
                          "processing"
                      }
                    >
                      {batchStatus ===
                      "processing"
                        ? "Processando lote..."
                        : "Processar CSV com IA"}
                    </button>
                  </div>
                )}


                {batchMessage && (
                  <div
                    className={`batch-message ${
                      batchStatus === "error"
                        ? "batch-message--error"
                        : batchStatus === "success"
                          ? "batch-message--success"
                          : ""
                    }`}
                  >
                    {batchMessage}
                  </div>
                )}


                {batchResult && (
                  <div className="batch-summary">
                    <div>
                      <span>
                        Registros
                      </span>

                      <strong>
                        {batchResult.total_rows}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Sucesso
                      </span>

                      <strong>
                        {batchResult.successful_rows}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Falhas
                      </span>

                      <strong>
                        {batchResult.failed_rows}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Tempo total
                      </span>

                      <strong>
                        {formatDuration(
                          batchResult.total_duration_ms,
                        )}
                      </strong>
                    </div>
                  </div>
                )}


                {batchResult?.failed_rows > 0 && (
                  <div className="batch-failure-list">
                    <strong>
                      Falhas do lote
                    </strong>

                    {batchResult.items
                      .filter(
                        (item) =>
                          !item.success,
                      )
                      .map((item) => (
                        <div
                          key={
                            item.row_number
                          }
                        >
                          <span>
                            Linha{" "}
                            {
                              item.row_number
                            }
                          </span>

                          <p>
                            {item.error ||
                              "Falha sem detalhe retornado."}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </section>


            {error && (
              <div className="error-message">
                {error}
              </div>
            )}


            <div className="form-actions">
              <div className="ai-status">
                <span className="ai-status__dot" />

                <span>
                  {AI_STATUS_LABEL}
                </span>
              </div>


              <button
                type="submit"
                className="primary-button"
                disabled={
                  status ===
                  "loading"
                }
              >
                {status ===
                "loading"
                  ? "Processando com IA..."
                  : selectedProjectId
                    ? "Atualizar projeto e processar"
                    : "Salvar projeto e processar"}
              </button>
            </div>
          </form>


          {/* ===============================================
              RESULTADO
          =============================================== */}

          {result && (
            <section
              className="result-panel"
              id="result-section"
            >
              <div className="result-panel__heading">
                <div>
                  <p className="eyebrow">
                    RESULTADO
                  </p>

                  <h2>
                    Base estruturada
                  </h2>

                  <p className="result-description">
                    Conteúdo
                    interpretado e
                    estruturado pela
                    Ylume AI.
                  </p>
                </div>


                <span className="mock-badge">
                  {result.provider ||
                    "Ylume AI"}
                </span>
              </div>


              {result.saved_project && (
                <div className="saved-project-message">
                  <span>
                    ✓ Projeto salvo
                    no PostgreSQL
                  </span>

                  <strong>
                    ID{" "}
                    {
                      result
                        .saved_project
                        .id
                    }
                  </strong>
                </div>
              )}


              <div className="result-table">
                {Object.entries(
                  result.structured_data ||
                    {},
                ).map(
                  ([
                    key,
                    value,
                  ]) => (
                    <div
                      className="result-row"
                      key={
                        key
                      }
                    >
                      <span>
                        {key}
                      </span>

                      <strong>
                        {formatResultValue(
                          value,
                        )}
                      </strong>
                    </div>
                  ),
                )}
              </div>


              <div className="result-meta">
                <div>
                  <span>
                    Processado por
                  </span>

                  <strong>
                    {result.provider ||
                      "Ylume AI"}
                  </strong>
                </div>


                {result.processed_at && (
                  <div>
                    <span>
                      Processado em
                    </span>

                    <strong>
                      {formatDate(
                        result.processed_at,
                      )}
                    </strong>
                  </div>
                )}

                {result.execution && (
                  <div>
                    <span>
                      Execução
                    </span>

                    <strong>
                      #{result.execution.id}
                      {" · "}
                      {result.execution.duration_ms ??
                        "—"}{" "}
                      ms
                    </strong>
                  </div>
                )}
              </div>


              <details className="technical-details">
                <summary>
                  Detalhes técnicos
                </summary>

                <div className="technical-details__content">
                  <p>
                    Resposta completa
                    recebida do pipeline
                    FastAPI → n8n →
                    AWS Bedrock.
                  </p>

                  <pre>
                    {JSON.stringify(
                      result,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </details>


              <div className="result-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    handleNewProject
                  }
                >
                  + Novo projeto
                </button>
              </div>
            </section>
          )}
            </>
          )}


          {activeView === "dashboard" && (
            <section className="dashboard-view">
              <div className="dashboard-heading">
                <div>
                  <p className="eyebrow">
                    DASHBOARD
                  </p>

                  <h1>
                    Visão do projeto.
                  </h1>

                  <p>
                    Acompanhe volume de execuções,
                    desempenho do processamento e
                    atividade recente da Ylume AI.
                  </p>
                </div>

                {selectedProjectId && (
                  <button
                    type="button"
                    className="secondary-button dashboard-back-button"
                    onClick={() =>
                      setActiveView(
                        "project",
                      )
                    }
                  >
                    Voltar ao projeto
                  </button>
                )}
              </div>


              {!selectedProjectId && (
                <div className="dashboard-empty">
                  <span className="dashboard-empty__icon">
                    Y
                  </span>

                  <h2>
                    Selecione um projeto
                  </h2>

                  <p>
                    Abra um projeto no histórico
                    para visualizar seus indicadores.
                  </p>
                </div>
              )}


              {selectedProjectId &&
                dashboardStatus ===
                  "loading" && (
                  <div className="dashboard-empty">
                    <h2>
                      Carregando dashboard...
                    </h2>
                  </div>
                )}


              {selectedProjectId &&
                dashboardStatus ===
                  "error" && (
                  <div className="error-message">
                    Não foi possível carregar
                    os indicadores do projeto.
                  </div>
                )}


              {selectedProjectId &&
                dashboardStatus ===
                  "success" &&
                dashboard && (
                  <>
                    <div className="dashboard-project-bar">
                      <div>
                        <span>
                          PROJETO
                        </span>

                        <strong>
                          {
                            dashboard.project_name
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          CAMPOS
                        </span>

                        <strong>
                          {
                            dashboard.field_count
                          }
                        </strong>
                      </div>
                    </div>


                    <div className="dashboard-cards">
                      <article className="metric-card">
                        <span>
                          Execuções
                        </span>

                        <strong>
                          {
                            dashboard.metrics
                              .total_executions
                          }
                        </strong>

                        <small>
                          processamentos registrados
                        </small>
                      </article>


                      <article className="metric-card">
                        <span>
                          Taxa de sucesso
                        </span>

                        <strong>
                          {
                            dashboard.metrics
                              .success_rate
                          }
                          %
                        </strong>

                        <small>
                          {
                            dashboard.metrics
                              .successful_executions
                          }{" "}
                          concluídas com sucesso
                        </small>
                      </article>


                      <article className="metric-card">
                        <span>
                          Tempo médio
                        </span>

                        <strong>
                          {formatDuration(
                            dashboard.metrics
                              .average_duration_ms,
                          )}
                        </strong>

                        <small>
                          tempo por processamento
                        </small>
                      </article>


                      <article className="metric-card">
                        <span>
                          Última execução
                        </span>

                        <strong className="metric-card__date">
                          {dashboard.metrics
                            .latest_processed_at
                            ? formatDate(
                                dashboard.metrics
                                  .latest_processed_at,
                              )
                            : "—"}
                        </strong>

                        <small>
                          atividade mais recente
                        </small>
                      </article>
                    </div>


                    <section className="dashboard-panel dashboard-panel--insights">
                      <div className="dashboard-panel__heading">
                        <div>
                          <p className="eyebrow">
                            DADOS ESTRUTURADOS
                          </p>

                          <h2>
                            Indicadores gerados pelo schema
                          </h2>

                          <p className="dashboard-panel__description">
                            A Ylume lê os campos definidos
                            neste projeto e cria análises
                            automaticamente a partir das
                            execuções salvas.
                          </p>
                        </div>
                      </div>


                      {(dashboard.field_insights || []).length ===
                        0 ? (
                        <p className="dashboard-panel__empty">
                          Ainda não existem dados
                          estruturados suficientes.
                        </p>
                      ) : (
                        <div className="insight-grid">
                          {(dashboard.field_insights || []).map(
                            (insight) => (
                              <article
                                className="insight-card"
                                key={insight.name}
                              >
                                <div className="insight-card__heading">
                                  <div>
                                    <strong>
                                      {insight.name}
                                    </strong>

                                    <span>
                                      {fieldTypeLabel(
                                        insight.field_type,
                                      )}
                                    </span>
                                  </div>

                                  <span className="insight-coverage">
                                    {insight.coverage_rate}% preenchido
                                  </span>
                                </div>


                                {insight.field_type ===
                                  "number" && (
                                  <div className="numeric-insight">
                                    <div>
                                      <span>
                                        Média
                                      </span>

                                      <strong>
                                        {formatNumber(
                                          insight.numeric_average,
                                        )}
                                      </strong>
                                    </div>

                                    <div>
                                      <span>
                                        Mínimo
                                      </span>

                                      <strong>
                                        {formatNumber(
                                          insight.numeric_min,
                                        )}
                                      </strong>
                                    </div>

                                    <div>
                                      <span>
                                        Máximo
                                      </span>

                                      <strong>
                                        {formatNumber(
                                          insight.numeric_max,
                                        )}
                                      </strong>
                                    </div>
                                  </div>
                                )}


                                {insight.distribution.length >
                                  0 ? (
                                  <div className="insight-bars">
                                    {insight.distribution.map(
                                      (item) => (
                                        <div
                                          className="insight-bar-row"
                                          key={`${insight.name}-${item.label}`}
                                        >
                                          <div className="insight-bar-row__top">
                                            <span
                                              title={
                                                item.label
                                              }
                                            >
                                              {item.label}
                                            </span>

                                            <strong>
                                              {item.count} · {item.percentage}%
                                            </strong>
                                          </div>

                                          <div className="insight-bar">
                                            <span
                                              style={{
                                                width: `${item.percentage}%`,
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                ) : (
                                  <div className="insight-summary">
                                    <div>
                                      <span>
                                        Valores encontrados
                                      </span>

                                      <strong>
                                        {insight.total_values}
                                      </strong>
                                    </div>

                                    <div>
                                      <span>
                                        Valores únicos
                                      </span>

                                      <strong>
                                        {insight.unique_values}
                                      </strong>
                                    </div>
                                  </div>
                                )}
                              </article>
                            ),
                          )}
                        </div>
                      )}
                    </section>


                    <div className="dashboard-grid">
                      <section className="dashboard-panel">
                        <div className="dashboard-panel__heading">
                          <div>
                            <p className="eyebrow">
                              PROVIDERS
                            </p>

                            <h2>
                              Processamento por IA
                            </h2>
                          </div>
                        </div>

                        {dashboard.providers.length ===
                          0 ? (
                          <p className="dashboard-panel__empty">
                            Ainda não existem
                            execuções para este
                            projeto.
                          </p>
                        ) : (
                          <div className="provider-list">
                            {dashboard.providers.map(
                              (provider) => (
                                <div
                                  className="provider-row"
                                  key={
                                    provider.provider
                                  }
                                >
                                  <div className="provider-row__top">
                                    <span>
                                      {
                                        provider.provider
                                      }
                                    </span>

                                    <strong>
                                      {
                                        provider.percentage
                                      }
                                      %
                                    </strong>
                                  </div>

                                  <div className="provider-bar">
                                    <span
                                      style={{
                                        width: `${provider.percentage}%`,
                                      }}
                                    />
                                  </div>

                                  <small>
                                    {
                                      provider.count
                                    }{" "}
                                    {provider.count ===
                                    1
                                      ? "execução"
                                      : "execuções"}
                                  </small>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </section>


                      <section className="dashboard-panel">
                        <div className="dashboard-panel__heading">
                          <div>
                            <p className="eyebrow">
                              STATUS
                            </p>

                            <h2>
                              Qualidade operacional
                            </h2>
                          </div>
                        </div>

                        <div className="status-summary">
                          <div>
                            <span className="status-dot status-dot--success" />

                            <p>
                              <strong>
                                {
                                  dashboard.metrics
                                    .successful_executions
                                }
                              </strong>

                              <span>
                                Sucesso
                              </span>
                            </p>
                          </div>

                          <div>
                            <span className="status-dot status-dot--error" />

                            <p>
                              <strong>
                                {
                                  dashboard.metrics
                                    .failed_executions
                                }
                              </strong>

                              <span>
                                Falhas
                              </span>
                            </p>
                          </div>
                        </div>
                      </section>
                    </div>


                    <section className="dashboard-panel dashboard-panel--recent">
                      <div className="dashboard-panel__heading">
                        <div>
                          <p className="eyebrow">
                            ATIVIDADE
                          </p>

                          <h2>
                            Execuções recentes
                          </h2>
                        </div>

                        <span className="execution-count">
                          últimas{" "}
                          {
                            dashboard
                              .recent_executions
                              .length
                          }
                        </span>
                      </div>

                      {dashboard
                        .recent_executions
                        .length === 0 ? (
                        <p className="dashboard-panel__empty">
                          Nenhuma execução salva.
                        </p>
                      ) : (
                        <div className="dashboard-execution-list">
                          {dashboard.recent_executions.map(
                            (
                              execution,
                            ) => (
                              <article
                                className="dashboard-execution-row"
                                key={
                                  execution.id
                                }
                              >
                                <div className="dashboard-execution-row__id">
                                  <strong>
                                    #
                                    {
                                      execution.id
                                    }
                                  </strong>

                                  <span>
                                    {execution.success
                                      ? "Sucesso"
                                      : "Falha"}
                                  </span>
                                </div>

                                <div className="dashboard-execution-row__text">
                                  <strong>
                                    {
                                      execution.provider
                                    }
                                  </strong>

                                  <span>
                                    {formatDate(
                                      execution.processed_at,
                                    )}
                                  </span>
                                </div>

                                <div className="dashboard-execution-row__duration">
                                  {formatDuration(
                                    execution.duration_ms,
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleViewExecution(
                                      execution,
                                    )
                                  }
                                >
                                  Ver resultado
                                </button>
                              </article>
                            ),
                          )}
                        </div>
                      )}
                    </section>
                  </>
                )}
            </section>
          )}


          {activeView === "dataset" && (
            <section className="dataset-view">
              <div className="dataset-heading">
                <div>
                  <p className="eyebrow">
                    DATASET
                  </p>

                  <h1>
                    Base estruturada.
                  </h1>

                  <p>
                    Consulte, filtre e exporte
                    todas as execuções deste
                    projeto em uma única tabela.
                  </p>
                </div>

                {selectedProjectId && (
                  <button
                    type="button"
                    className="secondary-button dataset-back-button"
                    onClick={() =>
                      setActiveView(
                        "project",
                      )
                    }
                  >
                    Voltar ao projeto
                  </button>
                )}
              </div>


              {!selectedProjectId && (
                <div className="dataset-empty">
                  <span className="dataset-empty__icon">
                    Y
                  </span>

                  <h2>
                    Selecione um projeto
                  </h2>

                  <p>
                    Abra um projeto no histórico
                    para visualizar seu dataset.
                  </p>
                </div>
              )}


              {selectedProjectId &&
                datasetStatus ===
                  "loading" && (
                  <div className="dataset-empty">
                    <h2>
                      Carregando dataset...
                    </h2>
                  </div>
                )}


              {selectedProjectId &&
                datasetStatus ===
                  "error" && (
                  <div className="error-message">
                    {datasetMessage ||
                      "Não foi possível carregar o dataset."}
                  </div>
                )}


              {selectedProjectId &&
                datasetStatus ===
                  "success" &&
                dataset && (
                  <>
                    <div className="dataset-project-bar">
                      <div>
                        <span>
                          PROJETO
                        </span>

                        <strong>
                          {
                            dataset.project_name
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          REGISTROS
                        </span>

                        <strong>
                          {
                            dataset.total_rows
                          }
                        </strong>
                      </div>
                    </div>


                    <section className="dataset-toolbar">
                      <div className="dataset-toolbar__filters">
                        <label>
                          Buscar

                          <input
                            type="search"
                            value={
                              datasetSearch
                            }
                            onChange={(
                              event,
                            ) =>
                              setDatasetSearch(
                                event.target
                                  .value,
                              )
                            }
                            placeholder="Texto, categoria, sentimento..."
                          />
                        </label>


                        <label>
                          Filtrar

                          <select
                            value={
                              datasetFilter
                            }
                            onChange={(
                              event,
                            ) =>
                              setDatasetFilter(
                                event.target
                                  .value,
                              )
                            }
                          >
                            <option value="all">
                              Todos
                            </option>

                            <option value="success">
                              Sucesso
                            </option>

                            <option value="failed">
                              Falhas
                            </option>
                          </select>
                        </label>


                        <label>
                          Ordenar

                          <select
                            value={
                              datasetSort
                            }
                            onChange={(
                              event,
                            ) =>
                              setDatasetSort(
                                event.target
                                  .value,
                              )
                            }
                          >
                            <option value="recent">
                              Mais recentes
                            </option>

                            <option value="oldest">
                              Mais antigos
                            </option>

                            <option value="id-desc">
                              ID decrescente
                            </option>

                            <option value="id-asc">
                              ID crescente
                            </option>
                          </select>
                        </label>
                      </div>


                      <div className="dataset-export">
                        <span>
                          EXPORTAR
                        </span>

                        <div>
                          <button
                            type="button"
                            disabled={
                              exportStatus !==
                              "idle"
                            }
                            onClick={() =>
                              handleExport(
                                "csv",
                              )
                            }
                          >
                            CSV
                          </button>

                          <button
                            type="button"
                            disabled={
                              exportStatus !==
                              "idle"
                            }
                            onClick={() =>
                              handleExport(
                                "xlsx",
                              )
                            }
                          >
                            Excel
                          </button>

                          <button
                            type="button"
                            disabled={
                              exportStatus !==
                              "idle"
                            }
                            onClick={() =>
                              handleExport(
                                "json",
                              )
                            }
                          >
                            JSON
                          </button>
                        </div>
                      </div>


                      <div className="dataset-maintenance">
                        <button
                          type="button"
                          onClick={() =>
                            loadDataset(
                              selectedProjectId,
                            )
                          }
                        >
                          ↻ Atualizar
                        </button>

                        <button
                          type="button"
                          className="dataset-clear-button"
                          disabled={
                            datasetActionStatus ===
                            "clearing"
                          }
                          onClick={
                            handleClearProjectExecutions
                          }
                        >
                          {datasetActionStatus ===
                          "clearing"
                            ? "Limpando..."
                            : "Limpar execuções"}
                        </button>
                      </div>
                    </section>


                    {datasetMessage && (
                      <div className="dataset-message">
                        {datasetMessage}
                      </div>
                    )}


                    <div className="dataset-count">
                      Exibindo{" "}
                      <strong>
                        {
                          visibleDatasetRows.length
                        }
                      </strong>{" "}
                      de{" "}
                      <strong>
                        {
                          dataset.total_rows
                        }
                      </strong>{" "}
                      registros
                    </div>


                    <section className="dataset-table-shell">
                      {visibleDatasetRows.length ===
                        0 ? (
                        <div className="dataset-table-empty">
                          Nenhum registro corresponde
                          aos filtros atuais.
                        </div>
                      ) : (
                        <div className="dataset-table-scroll">
                          <table className="dataset-table">
                            <thead>
                              <tr>
                                <th>
                                  ID
                                </th>

                                <th className="dataset-source-column">
                                  Conteúdo original
                                </th>

                                {dataset.fields.map(
                                  (field) => (
                                    <th
                                      key={
                                        field.name
                                      }
                                    >
                                      {
                                        field.name
                                      }
                                    </th>
                                  ),
                                )}

                                <th>
                                  Status
                                </th>

                                <th>
                                  Tempo
                                </th>

                                <th>
                                  Processado em
                                </th>

                                <th className="dataset-actions-column">
                                  Ações
                                </th>
                              </tr>
                            </thead>

                            <tbody>
                              {visibleDatasetRows.map(
                                (row) => (
                                  <tr
                                    key={
                                      row.execution_id
                                    }
                                  >
                                    <td>
                                      <strong>
                                        #
                                        {
                                          row.execution_id
                                        }
                                      </strong>
                                    </td>

                                    <td className="dataset-source-cell">
                                      <span title={row.source_text}>
                                        {
                                          row.source_text
                                        }
                                      </span>
                                    </td>

                                    {dataset.fields.map(
                                      (field) => (
                                        <td
                                          key={
                                            field.name
                                          }
                                        >
                                          {formatResultValue(
                                            row.values?.[
                                              field.name
                                            ],
                                          )}
                                        </td>
                                      ),
                                    )}

                                    <td>
                                      <span
                                        className={`dataset-status-badge ${
                                          row.success
                                            ? "dataset-status-badge--success"
                                            : "dataset-status-badge--error"
                                        }`}
                                        title={
                                          row.error ||
                                          ""
                                        }
                                      >
                                        {row.success
                                          ? "Sucesso"
                                          : "Falha"}
                                      </span>

                                      {!row.success &&
                                        row.error && (
                                          <small className="dataset-error-detail">
                                            {
                                              row.error
                                            }
                                          </small>
                                        )}
                                    </td>

                                    <td>
                                      {formatDuration(
                                        row.duration_ms,
                                      )}
                                    </td>

                                    <td>
                                      {formatDate(
                                        row.processed_at,
                                      )}
                                    </td>

                                    <td>
                                      <div className="dataset-row-actions">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleViewExecution({
                                              id:
                                                row.execution_id,
                                              project_id:
                                                row.project_id,
                                              source_text:
                                                row.source_text,
                                              structured_data:
                                                row.structured_data,
                                              provider:
                                                row.provider,
                                              success:
                                                row.success,
                                              duration_ms:
                                                row.duration_ms,
                                              processed_at:
                                                row.processed_at,
                                            })
                                          }
                                        >
                                          Ver
                                        </button>

                                        <button
                                          type="button"
                                          className="dataset-delete-button"
                                          onClick={() =>
                                            handleDeleteExecution(
                                              row.execution_id,
                                            )
                                          }
                                        >
                                          Excluir
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}


export default App;