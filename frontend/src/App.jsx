import { useEffect, useState } from "react";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

function App() {
  const [apiStatus, setApiStatus] = useState("loading");
  const [apiData, setApiData] = useState(null);

  useEffect(() => {
    async function checkApi() {
      try {
        const response = await fetch(`${API_URL}/health`);

        if (!response.ok) {
          throw new Error(`Erro HTTP: ${response.status}`);
        }

        const data = await response.json();

        setApiData(data);
        setApiStatus("online");
      } catch (error) {
        console.error("Erro ao conectar com a API:", error);
        setApiStatus("offline");
      }
    }

    checkApi();
  }, []);

  return (
    <main className="app">
      <section className="card">
        <div className="logo">Y</div>

        <p className="eyebrow">YLUME PLATFORM</p>

        <h1>Dados desestruturados.<br />Inteligência pronta para análise.</h1>

        <p className="description">
          Primeira conexão entre a interface React e a API FastAPI.
        </p>

        <div className={`status status--${apiStatus}`}>
          <span className="status__dot" />

          {apiStatus === "loading" && "Verificando API..."}

          {apiStatus === "online" &&
            `API conectada — ${apiData?.service}`}

          {apiStatus === "offline" &&
            "Não foi possível conectar à API"}
        </div>
      </section>
    </main>
  );
}

export default App;