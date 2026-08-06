import { useState } from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const createField = () => ({
  id: crypto.randomUUID(),
  name: "",
  field_type: "text",
  description: "",
});

function App() {
  const [form, setForm] = useState({
    project_name: "",
    context: "",
    objective: "",
    sample_text: "",
  });

  const [fields, setFields] = useState([
    {
      id: crypto.randomUUID(),
      name: "Categoria",
      field_type: "category",
      description: "Classificação principal do conteúdo.",
    },
    {
      id: crypto.randomUUID(),
      name: "Resumo",
      field_type: "text",
      description: "Síntese objetiva do conteúdo analisado.",
    },
  ]);

  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updateField(id, property, value) {
    setFields((current) =>
      current.map((field) =>
        field.id === id
          ? { ...field, [property]: value }
          : field,
      ),
    );
  }

  function addField() {
    setFields((current) => [...current, createField()]);
  }

  function removeField(id) {
    setFields((current) =>
      current.filter((field) => field.id !== id),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setStatus("loading");
    setError("");
    setResult(null);

    const validFields = fields
      .filter((field) => field.name.trim())
      .map(({ id, ...field }) => field);

    if (validFields.length === 0) {
      setStatus("error");
      setError("Adicione pelo menos um campo de saída.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/projects/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          fields: validFields,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail?.[0]?.msg ||
            "Não foi possível gerar a estrutura.",
        );
      }

      setResult(data);
      setStatus("success");
    } catch (requestError) {
      console.error(requestError);

      setStatus("error");
      setError(
        requestError.message ||
          "Erro ao conectar com a API.",
      );
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand__logo">Y</div>

          <div>
            <strong>Ylume</strong>
            <span>Data Structuring Platform</span>
          </div>
        </div>

        <div className="environment">
          <span />
          Ambiente local
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="sidebar__label">PROJETO</p>

          <button className="sidebar__item sidebar__item--active">
            01. Contexto
          </button>

          <button className="sidebar__item">
            02. Estrutura
          </button>

          <button className="sidebar__item">
            03. Processamento
          </button>

          <button className="sidebar__item">
            04. Dashboard
          </button>

          <div className="sidebar__research">
            <span>Research foundation</span>

            <p>
              Plataforma inspirada no estudo sobre estruturação
              e categorização de dados textuais com IA.
            </p>
          </div>
        </aside>

        <section className="content">
          <div className="content__heading">
            <div>
              <p className="eyebrow">NOVO PROJETO</p>

              <h1>Ensine a Ylume a compreender seus dados.</h1>

              <p>
                Defina o contexto, o objetivo e a estrutura que
                deseja obter.
              </p>
            </div>

            <div className="step-counter">Etapa 1 de 4</div>
          </div>

          <form className="project-form" onSubmit={handleSubmit}>
            <section className="panel">
              <div className="panel__heading">
                <span className="panel__number">01</span>

                <div>
                  <h2>Contexto do projeto</h2>

                  <p>
                    Explique o que representam os dados que serão
                    analisados.
                  </p>
                </div>
              </div>

              <label>
                Nome do projeto

                <input
                  name="project_name"
                  value={form.project_name}
                  onChange={updateForm}
                  placeholder="Ex.: Análise de registros operacionais"
                  minLength={2}
                  required
                />
              </label>

              <label>
                Contexto dos dados

                <textarea
                  name="context"
                  value={form.context}
                  onChange={updateForm}
                  placeholder="Ex.: Os registros são descrições textuais de ocorrências operacionais..."
                  rows={5}
                  minLength={5}
                  required
                />
              </label>

              <label>
                Objetivo da transformação

                <textarea
                  name="objective"
                  value={form.objective}
                  onChange={updateForm}
                  placeholder="Ex.: Identificar tema, prioridade, área responsável e gerar um resumo..."
                  rows={4}
                  minLength={5}
                  required
                />
              </label>
            </section>

            <section className="panel">
              <div className="panel__heading">
                <span className="panel__number">02</span>

                <div>
                  <h2>Estrutura de saída</h2>

                  <p>
                    Defina quais colunas deverão existir na base
                    estruturada.
                  </p>
                </div>
              </div>

              <div className="field-list">
                {fields.map((field, index) => (
                  <div className="field-card" key={field.id}>
                    <div className="field-card__top">
                      <span>Campo {index + 1}</span>

                      {fields.length > 1 && (
                        <button
                          type="button"
                          className="remove-button"
                          onClick={() => removeField(field.id)}
                        >
                          Remover
                        </button>
                      )}
                    </div>

                    <div className="field-grid">
                      <label>
                        Nome

                        <input
                          value={field.name}
                          onChange={(event) =>
                            updateField(
                              field.id,
                              "name",
                              event.target.value,
                            )
                          }
                          placeholder="Ex.: Prioridade"
                        />
                      </label>

                      <label>
                        Tipo

                        <select
                          value={field.field_type}
                          onChange={(event) =>
                            updateField(
                              field.id,
                              "field_type",
                              event.target.value,
                            )
                          }
                        >
                          <option value="text">Texto</option>
                          <option value="category">
                            Categoria
                          </option>
                          <option value="number">Número</option>
                          <option value="date">Data</option>
                          <option value="boolean">
                            Sim ou não
                          </option>
                        </select>
                      </label>
                    </div>

                    <label>
                      Orientação para a IA

                      <input
                        value={field.description}
                        onChange={(event) =>
                          updateField(
                            field.id,
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder="Explique o que deve ser identificado neste campo."
                      />
                    </label>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={addField}
              >
                + Adicionar campo
              </button>
            </section>

            <section className="panel">
              <div className="panel__heading">
                <span className="panel__number">03</span>

                <div>
                  <h2>Texto para teste</h2>

                  <p>
                    Nesta primeira versão, vamos testar um registro
                    individual.
                  </p>
                </div>
              </div>

              <label>
                Conteúdo não estruturado

                <textarea
                  name="sample_text"
                  value={form.sample_text}
                  onChange={updateForm}
                  placeholder="Cole aqui um texto, descrição, mensagem ou registro..."
                  rows={7}
                  required
                />
              </label>
            </section>

            {error && (
              <div className="error-message">{error}</div>
            )}

            <div className="form-actions">
              <span>
                A IA ainda está em modo de simulação.
              </span>

              <button
                type="submit"
                className="primary-button"
                disabled={status === "loading"}
              >
                {status === "loading"
                  ? "Gerando estrutura..."
                  : "Gerar prévia estruturada"}
              </button>
            </div>
          </form>

          {result && (
            <section className="result-panel">
              <div className="result-panel__heading">
                <div>
                  <p className="eyebrow">RESULTADO</p>
                  <h2>Prévia da base estruturada</h2>
                </div>

                <span className="mock-badge">
                  Provider: {result.provider}
                </span>
              </div>

              <div className="result-table">
                {Object.entries(result.structured_data).map(
                  ([key, value]) => (
                    <div className="result-row" key={key}>
                      <span>{key}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  ),
                )}
              </div>

              <pre>{JSON.stringify(result, null, 2)}</pre>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;