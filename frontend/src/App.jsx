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
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#08070d",
        color: "#ffffff",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1>Ylume Platform</h1>
        <p>{status}</p>
      </div>
    </div>
  );
}

export default App;