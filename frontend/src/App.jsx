import { useEffect, useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function App() {
  const [status, setStatus] = useState("Verificando API...");

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Erro HTTP: ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        setStatus(`API conectada — ${data.service}`);
      })
      .catch((error) => {
        console.error(error);
        setStatus("API desconectada");
      });
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "30px",
        background: "#08070d",
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(720px, 100%)",
          padding: "55px",
          border: "1px solid #2c2538",
          borderRadius: "28px",
          background: "#100d19",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            display: "grid",
            placeItems: "center",
            marginBottom: "30px",
            borderRadius: "15px",
            background: "linear-gradient(145deg, #a78bfa, #6d28d9)",
            fontSize: "24px",
            fontWeight: "bold",
          }}
        >
          Y
        </div>

        <p
          style={{
            color: "#a78bfa",
            fontSize: "12px",
            fontWeight: "bold",
            letterSpacing: "3px",
          }}
        >
          YLUME PLATFORM
        </p>

        <h1
          style={{
            margin: "14px 0",
            fontSize: "52px",
            lineHeight: 1.05,
          }}
        >
          Dados desestruturados.
          <br />
          Inteligência pronta para análise.
        </h1>

        <p style={{ color: "#aaa4b7", fontSize: "17px" }}>
          Primeira conexão entre o frontend React e a API FastAPI.
        </p>

        <div
          style={{
            display: "inline-block",
            marginTop: "24px",
            padding: "12px 18px",
            borderRadius: "999px",
            background: "#1d172b",
            color: "#d2c5fa",
          }}
        >
          {status}
        </div>
      </section>
    </main>
  );
}

export default App;