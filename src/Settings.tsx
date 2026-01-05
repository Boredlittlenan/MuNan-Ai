import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Settings() {
  const navigate = useNavigate(); 
  const [apiKey, setApiKey] = useState(localStorage.getItem("apiKey") || "");

  const saveApiKey = () => {
    localStorage.setItem("apiKey", apiKey);
    alert("API Key 已保存！");
  };

  const clearApiKey = () => {
    localStorage.removeItem("apiKey");
    setApiKey("");
    alert("API Key 已清除！");
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 800 }}>
      <h2>设置</h2>
      <div style={{ marginBottom: 20 }}>
        <label>
          API Key:
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ marginLeft: 10, width: "60%" }}
          />
        </label>
      </div>
      <div>
        <button onClick={saveApiKey} style={{ marginRight: 10 }}>
          保存
        </button>
        <button onClick={clearApiKey} style={{ marginRight: 10 }}>
          清除
        </button>
        <button onClick={() => navigate("/")}>返回</button> {/* 🔑 v6 用 navigate */}
      </div>
    </div>
  );
}

export default Settings;
