import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./styles/base.css";
import "./styles/Settings.css";

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
    <div className="main-container">
      <div className="nav-container">
        <button onClick={() => navigate("/")}>返回</button> {/* 🔑 v6 用 navigate */}
        <h2>设置</h2>
      </div>

      <div className="setting-item">
        <label>
          API Key:
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ marginLeft: 10, width: "60%" }}
          />
          <button onClick={saveApiKey}>
            保存
          </button>
          <button onClick={clearApiKey}>
            清除
          </button>
        </label>

      </div>
      <div>


      </div>
    </div>
  );
}

export default Settings;
