use std::env;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    llm_base_url: String,
    llm_models_endpoint: String,
    llm_chat_endpoint: String,
    llm_model: String,
    llm_timeout_ms: u64,
    assistant_system_prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ok: bool,
    model_count: usize,
    latency_ms: u128,
    endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    messages: Vec<ChatMessage>,
    model: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatResponse {
    content: String,
    model: String,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
}

#[derive(Debug, Serialize)]
struct UpstreamChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    model: Option<String>,
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: AssistantMessage,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    content: Option<serde_json::Value>,
}

fn env_var(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

fn env_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn normalize_base_url(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

fn build_runtime_config() -> RuntimeConfig {
    let llm_base_url = normalize_base_url(env_var("LLM_BASE_URL", "http://192.168.1.151:18080"));
    let llm_models_endpoint = env_var("LLM_MODELS_ENDPOINT", &format!("{llm_base_url}/v1/models"));
    let llm_chat_endpoint = env_var(
        "LLM_CHAT_ENDPOINT",
        &format!("{llm_base_url}/v1/chat/completions"),
    );

    RuntimeConfig {
        llm_base_url,
        llm_models_endpoint,
        llm_chat_endpoint,
        llm_model: env_var("LLM_MODEL", "gemma-3-1b-it-Q4_K_M.gguf"),
        llm_timeout_ms: env_u64("LLM_TIMEOUT_MS", 30_000),
        assistant_system_prompt: env_var(
            "ASSISTANT_SYSTEM_PROMPT",
            "You are a concise local desktop assistant. Answer clearly, stay grounded in available context, and do not invent facts when the app can look them up instead.",
        ),
    }
}

fn build_http_client(timeout_ms: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))
}

fn extract_text_content(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text),
        serde_json::Value::Array(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
                .collect::<String>();

            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        _ => None,
    }
}

#[tauri::command]
fn get_runtime_config() -> RuntimeConfig {
    build_runtime_config()
}

#[tauri::command]
async fn check_backend() -> Result<BackendStatus, String> {
    let config = build_runtime_config();
    let client = build_http_client(config.llm_timeout_ms)?;
    let started = std::time::Instant::now();

    let response = client
        .get(&config.llm_models_endpoint)
        .send()
        .await
        .map_err(|error| format!("Backend request failed: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        return Err(format!(
            "Models endpoint returned HTTP {} from {}",
            status.as_u16(),
            config.llm_models_endpoint
        ));
    }

    let models = response
        .json::<ModelsResponse>()
        .await
        .map_err(|error| format!("Could not decode models response: {error}"))?;

    Ok(BackendStatus {
        ok: true,
        model_count: models.data.len(),
        latency_ms: started.elapsed().as_millis(),
        endpoint: config.llm_models_endpoint,
    })
}

#[tauri::command]
async fn list_models() -> Result<Vec<String>, String> {
    let config = build_runtime_config();
    let client = build_http_client(config.llm_timeout_ms)?;

    let response = client
        .get(&config.llm_models_endpoint)
        .send()
        .await
        .map_err(|error| format!("Backend request failed: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        return Err(format!(
            "Models endpoint returned HTTP {} from {}",
            status.as_u16(),
            config.llm_models_endpoint
        ));
    }

    let models = response
        .json::<ModelsResponse>()
        .await
        .map_err(|error| format!("Could not decode models response: {error}"))?;

    Ok(models.data.into_iter().map(|model| model.id).collect())
}

#[tauri::command]
async fn chat_completion(request: ChatRequest) -> Result<ChatResponse, String> {
    let config = build_runtime_config();
    let client = build_http_client(config.llm_timeout_ms)?;

    let mut messages = Vec::new();
    let system_prompt = request
        .system_prompt
        .unwrap_or_else(|| config.assistant_system_prompt.clone());

    if !system_prompt.trim().is_empty() {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        });
    }

    messages.extend(request.messages);

    let upstream_request = UpstreamChatRequest {
        model: request.model.unwrap_or_else(|| config.llm_model.clone()),
        messages,
        max_tokens: request.max_tokens.unwrap_or(192),
        temperature: request.temperature.unwrap_or(0.35),
        stream: false,
    };

    let response = client
        .post(&config.llm_chat_endpoint)
        .json(&upstream_request)
        .send()
        .await
        .map_err(|error| format!("Chat request failed: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Chat endpoint returned HTTP {} from {}. {}",
            status.as_u16(),
            config.llm_chat_endpoint,
            body
        ));
    }

    let completion = response
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|error| format!("Could not decode chat response: {error}"))?;

    let choice = completion
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| "Chat response did not include any choices".to_string())?;

    let content = choice
        .message
        .content
        .and_then(extract_text_content)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "Chat response did not include assistant text".to_string())?;

    Ok(ChatResponse {
        content,
        model: completion
            .model
            .unwrap_or_else(|| upstream_request.model.to_string()),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_runtime_config,
            check_backend,
            list_models,
            chat_completion
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
