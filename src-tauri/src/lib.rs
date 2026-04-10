use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use cpal::traits::{DeviceTrait, HostTrait};
use reqwest::Client;
use rodio::{Decoder, OutputStream, Sink};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    backend_type: String,
    llm_base_url: String,
    llm_models_endpoint: String,
    llm_chat_endpoint: String,
    llm_control_base_url: String,
    llm_control_health_endpoint: String,
    llm_control_models_endpoint: String,
    llm_control_switch_endpoint: String,
    searxng_url: String,
    llm_model: String,
    llm_timeout_ms: u64,
    assistant_system_prompt: String,
    assistant_personality_preset: String,
    assistant_personality_custom: String,
    stt_backend: String,
    whisper_cpp_path: String,
    whisper_model_path: String,
    stt_language: String,
    stt_threads: u32,
    tts_backend: String,
    tts_voice: String,
    tts_output_device: String,
    tts_rate: f64,
    tts_volume: f64,
    tts_pitch: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ok: bool,
    model_count: usize,
    latency_ms: u128,
    endpoint: String,
    active_model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlState {
    ready: bool,
    current_alias: Option<String>,
    default_alias: Option<String>,
    backup_alias: Option<String>,
    current_model: Option<String>,
    live_model: Option<String>,
    configured_model: Option<String>,
    models: Vec<ControlModelProfile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlModelProfile {
    alias: String,
    model: String,
    role: String,
    ui_tier: String,
    recommended: bool,
    client_prompt_prefix: String,
    note: String,
    active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SwitchModelResponse {
    ok: bool,
    alias: Option<String>,
    model: Option<String>,
    client_prompt_prefix: String,
    stdout: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    messages: Vec<ChatMessage>,
    prompt: Option<String>,
    model: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    system_prompt: Option<String>,
    request_id: Option<String>,
    tool_mode: Option<String>,
    file_path: Option<String>,
    current_date: Option<String>,
    trusted_context: Option<String>,
    conversation_id: Option<i64>,
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
    tool_mode: Option<String>,
    tool_detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatStreamEvent {
    request_id: String,
    delta: Option<String>,
    model: Option<String>,
    done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantProgressEvent {
    request_id: String,
    stage: String,
    message: String,
    tone: String,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsStatus {
    available: bool,
    backend: String,
    speaking: bool,
    active_voice: Option<String>,
    active_output_device: Option<String>,
    configured_voice: String,
    configured_output_device: String,
    voices: Vec<TtsVoice>,
    output_devices: Vec<AudioOutputDevice>,
    rate: f64,
    volume: f64,
    pitch: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsVoice {
    id: String,
    name: String,
    language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioOutputDevice {
    id: String,
    name: String,
    is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsStateEvent {
    state: String,
    speaking: bool,
    voice: Option<String>,
    output_device: Option<String>,
    message: String,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SttStatus {
    available: bool,
    ready: bool,
    backend: String,
    configured_binary_path: String,
    configured_model_path: String,
    language: String,
    threads: u32,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeAudioRequest {
    audio_bytes: Vec<u8>,
    language: Option<String>,
    prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeAudioResponse {
    text: String,
    backend: String,
    language: String,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
}

#[derive(Debug, Deserialize)]
struct ControlStateApiResponse {
    ready: bool,
    current_alias: Option<String>,
    default_alias: Option<String>,
    backup_alias: Option<String>,
    current_model: Option<String>,
    live_model: Option<String>,
    configured_model: Option<String>,
    models: Option<Vec<ControlModelProfileApiResponse>>,
}

#[derive(Debug, Deserialize)]
struct ControlModelProfileApiResponse {
    alias: String,
    model: String,
    role: Option<String>,
    ui_tier: Option<String>,
    recommended: Option<bool>,
    client_prompt_prefix: Option<String>,
    note: Option<String>,
    active: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct SwitchModelApiResponse {
    ok: bool,
    switched_to: Option<String>,
    model: Option<String>,
    client_prompt_prefix: Option<String>,
    stdout: Option<String>,
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

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    model: Option<String>,
    choices: Vec<ChatChunkChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChunkChoice {
    delta: ChatChunkDelta,
}

#[derive(Debug, Deserialize)]
struct ChatChunkDelta {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearxngSearchResponse {
    results: Vec<SearxngSearchResult>,
}

#[derive(Debug, Deserialize)]
struct SearxngSearchResult {
    title: String,
    url: String,
    content: String,
    engine: Option<String>,
}

#[derive(Debug)]
struct ToolEvidence {
    mode: String,
    detail: String,
    trusted_context: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeakTextRequest {
    text: String,
    voice_id: Option<String>,
    device_id: Option<String>,
    rate: Option<f64>,
    volume: Option<f64>,
    pitch: Option<f64>,
}

#[derive(Debug)]
struct TtsPlaybackState {
    speaking: bool,
    current_voice: Option<String>,
    current_output_device: Option<String>,
}

enum AudioCmd {
    Speak {
        wav: Vec<u8>,
        voice_name: Option<String>,
        device_name: Option<String>,
        cancelled: Arc<AtomicBool>,
    },
    Enqueue {
        wav: Vec<u8>,
    },
    Stop,
}

struct AudioState {
    tx: mpsc::SyncSender<AudioCmd>,
    cancelled: Arc<AtomicBool>,
    playback: Arc<Mutex<TtsPlaybackState>>,
}

struct SettingsState {
    conn: Mutex<Connection>,
}

impl SettingsState {
    /// Read all persisted settings from the DB as a flat map.
    fn all(&self) -> HashMap<String, String> {
        let Ok(conn) = self.conn.lock() else {
            return HashMap::new();
        };
        let Ok(mut stmt) = conn.prepare("SELECT key, value FROM settings") else {
            return HashMap::new();
        };
        stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    /// Build a RuntimeConfig from DB settings, falling back to env vars then defaults.
    fn build_config(&self) -> RuntimeConfig {
        let db = self.all();

        let get = |db_key: &str, env_key: &str, default: &str| -> String {
            db.get(db_key)
                .cloned()
                .or_else(|| env::var(env_key).ok())
                .unwrap_or_else(|| default.to_string())
        };

        let get_f64 = |db_key: &str, env_key: &str, default: f64| -> f64 {
            db.get(db_key)
                .and_then(|v| v.parse::<f64>().ok())
                .or_else(|| env::var(env_key).ok().and_then(|v| v.parse::<f64>().ok()))
                .unwrap_or(default)
        };

        let get_u64 = |db_key: &str, env_key: &str, default: u64| -> u64 {
            db.get(db_key)
                .and_then(|v| v.parse::<u64>().ok())
                .or_else(|| env::var(env_key).ok().and_then(|v| v.parse::<u64>().ok()))
                .unwrap_or(default)
        };

        let get_u32 = |db_key: &str, env_key: &str, default: u32| -> u32 {
            db.get(db_key)
                .and_then(|v| v.parse::<u32>().ok())
                .or_else(|| env::var(env_key).ok().and_then(|v| v.parse::<u32>().ok()))
                .unwrap_or(default)
        };

        let backend_type = get("backend_type", "BACKEND_TYPE", "llamacpp");
        let llm_base_url = normalize_base_url(get(
            "llm_base_url",
            "LLM_BASE_URL",
            "http://192.168.1.151:18080",
        ));
        let llm_models_endpoint = get(
            "llm_models_endpoint",
            "LLM_MODELS_ENDPOINT",
            &format!("{llm_base_url}/v1/models"),
        );
        let llm_chat_endpoint = get(
            "llm_chat_endpoint",
            "LLM_CHAT_ENDPOINT",
            &format!("{llm_base_url}/v1/chat/completions"),
        );
        let llm_control_base_url = normalize_base_url(get(
            "llm_control_base_url",
            "LLM_CONTROL_BASE_URL",
            "http://192.168.1.151:18082",
        ));
        let llm_control_health_endpoint = get(
            "llm_control_health_endpoint",
            "LLM_CONTROL_HEALTH_ENDPOINT",
            &format!("{llm_control_base_url}/health"),
        );
        let llm_control_models_endpoint = get(
            "llm_control_models_endpoint",
            "LLM_CONTROL_MODELS_ENDPOINT",
            &format!("{llm_control_base_url}/api/models"),
        );
        let llm_control_switch_endpoint = get(
            "llm_control_switch_endpoint",
            "LLM_CONTROL_SWITCH_ENDPOINT",
            &format!("{llm_control_base_url}/api/switch"),
        );
        let searxng_url = normalize_searxng_url(get(
            "searxng_url",
            "SEARXNG_URL",
            "http://192.168.1.151:8888",
        ));
        let stt_backend = normalize_stt_backend(get("stt_backend", "STT_BACKEND", "whispercpp"));
        let tts_backend = normalize_tts_backend(get("tts_backend", "TTS_BACKEND", "winrt"));

        RuntimeConfig {
            backend_type,
            llm_base_url,
            llm_models_endpoint,
            llm_chat_endpoint,
            llm_control_base_url,
            llm_control_health_endpoint,
            llm_control_models_endpoint,
            llm_control_switch_endpoint,
            searxng_url,
            llm_model: get("llm_model", "LLM_MODEL", "gemma-3-1b-it-Q4_K_M.gguf"),
            llm_timeout_ms: get_u64("llm_timeout_ms", "LLM_TIMEOUT_MS", 30_000),
            assistant_system_prompt: get(
                "assistant_system_prompt",
                "ASSISTANT_SYSTEM_PROMPT",
                "You are a concise local desktop assistant. Answer clearly, stay grounded in available context, and do not invent facts when the app can look them up instead.",
            ),
            assistant_personality_preset: get(
                "assistant_personality_preset",
                "ASSISTANT_PERSONALITY_PRESET",
                "balanced",
            ),
            assistant_personality_custom: get(
                "assistant_personality_custom",
                "ASSISTANT_PERSONALITY_CUSTOM",
                "",
            ),
            stt_backend,
            whisper_cpp_path: get("whisper_cpp_path", "WHISPER_CPP_PATH", ""),
            whisper_model_path: get("whisper_model_path", "WHISPER_MODEL_PATH", ""),
            stt_language: get("stt_language", "STT_LANGUAGE", "en"),
            stt_threads: get_u32("stt_threads", "STT_THREADS", 4).clamp(1, 16),
            tts_backend,
            tts_voice: get("tts_voice", "TTS_VOICE", "Microsoft Zira Desktop"),
            tts_output_device: get("tts_output_device", "TTS_OUTPUT_DEVICE", ""),
            tts_rate: normalize_tts_rate(get_f64("tts_rate", "TTS_RATE", 1.0)),
            tts_volume: normalize_tts_volume(get_f64("tts_volume", "TTS_VOLUME", 1.0)),
            tts_pitch: normalize_tts_pitch(get_f64("tts_pitch", "TTS_PITCH", 0.0)),
        }
    }
}

fn normalize_base_url(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

fn normalize_searxng_url(value: String) -> String {
    let trimmed = value.trim_end_matches('/').to_string();

    if trimmed.ends_with("/search") {
        trimmed
    } else {
        format!("{trimmed}/search")
    }
}

fn normalize_stt_backend(value: String) -> String {
    match value.trim().to_lowercase().as_str() {
        "" | "whisper.cpp" | "whispercpp" => "whispercpp".to_string(),
        other => other.to_string(),
    }
}

fn normalize_tts_backend(value: String) -> String {
    match value.trim().to_lowercase().as_str() {
        "sapi" | "winrt" | "" => "winrt".to_string(),
        other => other.to_string(),
    }
}

fn normalize_tts_rate(value: f64) -> f64 {
    if value <= 0.0 {
        1.0
    } else {
        value.clamp(0.5, 3.0)
    }
}

fn normalize_tts_volume(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn normalize_tts_pitch(value: f64) -> f64 {
    value.clamp(-1.0, 1.0)
}

fn init_settings_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve app config dir: {error}"))?
        .join("settings.db");

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create config directory: {error}"))?;
    }

    let conn = Connection::open(&db_path)
        .map_err(|error| format!("Could not open settings database: {error}"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT    NOT NULL DEFAULT (datetime('now')),
            title      TEXT,
            summary    TEXT
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id     INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role                TEXT    NOT NULL,
            content             TEXT    NOT NULL,
            meta                TEXT,
            tool_mode           TEXT,
            include_in_context  INTEGER NOT NULL DEFAULT 1,
            created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|error| format!("Could not initialize database schema: {error}"))?;

    // Non-fatal migrations for DBs created before this column existed.
    let _ = conn.execute("ALTER TABLE conversations ADD COLUMN summary TEXT", []);

    Ok(conn)
}

const MAX_FILE_BYTES: usize = 64 * 1024;
const MAX_FILE_CHARS: usize = 16_000;
const MAX_SEARCH_RESULTS: usize = 5;
const MAX_SEARCH_SNIPPET_CHARS: usize = 280;

fn build_http_client(timeout_ms: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))
}

fn emit_tts_state(
    app: &tauri::AppHandle,
    state: &str,
    speaking: bool,
    voice: Option<String>,
    output_device: Option<String>,
    message: &str,
    detail: Option<String>,
) -> Result<(), String> {
    app.emit(
        "tts-state",
        TtsStateEvent {
            state: state.to_string(),
            speaking,
            voice,
            output_device,
            message: message.to_string(),
            detail,
        },
    )
    .map_err(|error| format!("Could not emit TTS state event: {error}"))
}

fn set_playback_state(
    playback: &Arc<Mutex<TtsPlaybackState>>,
    speaking: bool,
    voice: Option<String>,
    output_device: Option<String>,
) -> Result<(), String> {
    let mut state = playback
        .lock()
        .map_err(|_| "Could not acquire the TTS playback lock.".to_string())?;

    state.speaking = speaking;
    state.current_voice = voice;
    state.current_output_device = output_device;

    Ok(())
}

fn default_output_device_name() -> Option<String> {
    cpal::default_host()
        .default_output_device()
        .and_then(|device| device.name().ok())
}

fn list_audio_devices() -> Vec<AudioOutputDevice> {
    let host = cpal::default_host();
    let default_device_name = default_output_device_name();
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };

    devices
        .filter_map(|device| {
            let name = device.name().ok()?;

            Some(AudioOutputDevice {
                id: name.clone(),
                name: name.clone(),
                is_default: default_device_name.as_deref() == Some(name.as_str()),
            })
        })
        .collect()
}

#[cfg(windows)]
fn list_winrt_voices() -> Result<Vec<TtsVoice>, String> {
    use windows::Media::SpeechSynthesis::SpeechSynthesizer;

    let voices = SpeechSynthesizer::AllVoices().map_err(|error| error.to_string())?;
    let count = voices.Size().map_err(|error| error.to_string())?;

    Ok((0..count)
        .filter_map(|index| {
            let voice = voices.GetAt(index).ok()?;
            Some(TtsVoice {
                id: voice.Id().ok()?.to_string(),
                name: voice.DisplayName().ok()?.to_string(),
                language: voice.Language().ok()?.to_string(),
            })
        })
        .collect())
}

#[cfg(not(windows))]
fn list_winrt_voices() -> Result<Vec<TtsVoice>, String> {
    Ok(Vec::new())
}

fn resolve_voice_selection(
    voices: &[TtsVoice],
    requested_voice: Option<&str>,
    configured_voice: &str,
) -> Option<TtsVoice> {
    let matches_voice = |voice: &TtsVoice, candidate: &str| {
        voice.id == candidate || voice.name.eq_ignore_ascii_case(candidate)
    };

    requested_voice
        .filter(|value| !value.trim().is_empty())
        .and_then(|requested| {
            voices
                .iter()
                .find(|voice| matches_voice(voice, requested))
                .cloned()
        })
        .or_else(|| {
            if configured_voice.trim().is_empty() {
                None
            } else {
                voices
                    .iter()
                    .find(|voice| matches_voice(voice, configured_voice))
                    .cloned()
            }
        })
        .or_else(|| voices.first().cloned())
}

fn resolve_output_device_selection(
    devices: &[AudioOutputDevice],
    requested_device: Option<&str>,
    configured_device: &str,
) -> Option<AudioOutputDevice> {
    requested_device
        .filter(|value| !value.trim().is_empty())
        .and_then(|requested| {
            devices
                .iter()
                .find(|device| {
                    device.id == requested || device.name.eq_ignore_ascii_case(requested)
                })
                .cloned()
        })
        .or_else(|| {
            if configured_device.trim().is_empty() {
                None
            } else {
                devices
                    .iter()
                    .find(|device| {
                        device.id == configured_device
                            || device.name.eq_ignore_ascii_case(configured_device)
                    })
                    .cloned()
            }
        })
}

fn spawn_audio_thread(
    app: tauri::AppHandle,
    playback: Arc<Mutex<TtsPlaybackState>>,
) -> mpsc::SyncSender<AudioCmd> {
    let (tx, rx) = mpsc::sync_channel::<AudioCmd>(8);

    std::thread::spawn(move || {
        let mut _current_stream: Option<OutputStream> = None;
        let mut current_sink: Option<Arc<Sink>> = None;

        for command in rx {
            match command {
                AudioCmd::Stop => {
                    if let Some(sink) = &current_sink {
                        sink.stop();
                    }
                    current_sink = None;
                    _current_stream = None;
                }
                AudioCmd::Enqueue { wav } => {
                    if let Some(sink) = &current_sink {
                        let cursor = std::io::Cursor::new(wav);
                        if let Ok(source) = Decoder::new(cursor) {
                            sink.append(source);
                        }
                    }
                    // If no sink is active (very short first sentence), silently drop.
                    // The polling watcher's grace window covers the common race.
                }
                AudioCmd::Speak {
                    wav,
                    voice_name,
                    device_name,
                    cancelled,
                } => {
                    if let Some(sink) = &current_sink {
                        sink.stop();
                    }
                    current_sink = None;
                    _current_stream = None;

                    let host = cpal::default_host();
                    let device = device_name
                        .as_deref()
                        .and_then(|requested_name| {
                            host.output_devices().ok()?.find(|candidate| {
                                candidate.name().ok().as_deref() == Some(requested_name)
                            })
                        })
                        .or_else(|| host.default_output_device());

                    let Some(device) = device else {
                        let _ = set_playback_state(&playback, false, None, None);
                        let _ = emit_tts_state(
                            &app,
                            "error",
                            false,
                            voice_name.clone(),
                            None,
                            "No audio output device is available.",
                            None,
                        );
                        continue;
                    };

                    let resolved_device_name = device.name().ok();

                    let Ok((stream, handle)) = OutputStream::try_from_device(&device) else {
                        let _ = set_playback_state(&playback, false, None, None);
                        let _ = emit_tts_state(
                            &app,
                            "error",
                            false,
                            voice_name.clone(),
                            resolved_device_name.clone(),
                            "Could not open the selected audio output device.",
                            None,
                        );
                        continue;
                    };

                    let Ok(sink) = Sink::try_new(&handle) else {
                        let _ = set_playback_state(&playback, false, None, None);
                        let _ = emit_tts_state(
                            &app,
                            "error",
                            false,
                            voice_name.clone(),
                            resolved_device_name.clone(),
                            "Could not create the playback sink.",
                            None,
                        );
                        continue;
                    };

                    let cursor = std::io::Cursor::new(wav);
                    let Ok(source) = Decoder::new(cursor) else {
                        let _ = set_playback_state(&playback, false, None, None);
                        let _ = emit_tts_state(
                            &app,
                            "error",
                            false,
                            voice_name.clone(),
                            resolved_device_name.clone(),
                            "Could not decode the synthesized speech audio.",
                            None,
                        );
                        continue;
                    };

                    sink.append(source);

                    let sink = Arc::new(sink);
                    let sink_wait = Arc::clone(&sink);
                    let app_wait = app.clone();
                    let playback_wait = Arc::clone(&playback);
                    let voice_for_event = voice_name.clone();
                    let device_for_event = resolved_device_name.clone();

                    // Poll rather than block on sleep_until_end so that sentences
                    // appended via Enqueue extend the wait window instead of
                    // triggering a premature idle event.
                    std::thread::spawn(move || {
                        loop {
                            std::thread::sleep(Duration::from_millis(50));
                            if cancelled.load(Ordering::Relaxed) {
                                break;
                            }
                            if sink_wait.empty() {
                                // Grace window: let any in-flight Enqueue append before
                                // we declare the whole queue done.
                                std::thread::sleep(Duration::from_millis(200));
                                if cancelled.load(Ordering::Relaxed) {
                                    break;
                                }
                                if sink_wait.empty() {
                                    let _ = set_playback_state(&playback_wait, false, None, None);
                                    let _ = emit_tts_state(
                                        &app_wait,
                                        "idle",
                                        false,
                                        voice_for_event,
                                        device_for_event,
                                        "Speech finished.",
                                        None,
                                    );
                                    break;
                                }
                            }
                        }
                    });

                    current_sink = Some(sink);
                    _current_stream = Some(stream);
                }
            }
        }
    });

    tx
}

fn ssml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(windows)]
fn synthesize_text_to_wav(
    text: &str,
    voice_id: Option<&str>,
    rate: f64,
    volume: f64,
    pitch: f64,
) -> Result<Vec<u8>, String> {
    use windows::{
        core::{Interface, HSTRING},
        Media::SpeechSynthesis::SpeechSynthesizer,
        Storage::Streams::{DataReader, IInputStream},
        Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let synthesizer = SpeechSynthesizer::new().map_err(|error| error.to_string())?;
    let options = synthesizer.Options().map_err(|error| error.to_string())?;
    options
        .SetSpeakingRate(normalize_tts_rate(rate))
        .map_err(|error| error.to_string())?;
    options
        .SetAudioVolume(normalize_tts_volume(volume))
        .map_err(|error| error.to_string())?;

    if let Some(target_voice_id) = voice_id.filter(|value| !value.trim().is_empty()) {
        let target = HSTRING::from(target_voice_id);
        let voices = SpeechSynthesizer::AllVoices().map_err(|error| error.to_string())?;
        let count = voices.Size().map_err(|error| error.to_string())?;

        for index in 0..count {
            if let Ok(voice) = voices.GetAt(index) {
                if voice.Id().ok().as_ref() == Some(&target) {
                    synthesizer
                        .SetVoice(&voice)
                        .map_err(|error| error.to_string())?;
                    break;
                }
            }
        }
    }

    // WinRT options API does not expose a pitch setter in the current bindings.
    // Use SSML prosody when pitch is non-zero so the underlying engine applies it.
    let normalized_pitch = normalize_tts_pitch(pitch);
    let pitch_pct = (normalized_pitch * 50.0).round() as i64;

    let stream = if pitch_pct != 0 {
        let escaped = ssml_escape(text);
        let ssml = format!(
            "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\"><prosody pitch=\"{pitch_pct:+}%\">{escaped}</prosody></speak>"
        );
        synthesizer
            .SynthesizeSsmlToStreamAsync(&HSTRING::from(ssml.as_str()))
            .map_err(|error| error.to_string())?
            .get()
            .map_err(|error| error.to_string())?
    } else {
        synthesizer
            .SynthesizeTextToStreamAsync(&HSTRING::from(text))
            .map_err(|error| error.to_string())?
            .get()
            .map_err(|error| error.to_string())?
    };

    let size = stream.Size().map_err(|error| error.to_string())? as u32;
    let input_stream: IInputStream = stream.cast().map_err(|error| error.to_string())?;
    let reader = DataReader::CreateDataReader(&input_stream).map_err(|error| error.to_string())?;
    reader
        .LoadAsync(size)
        .map_err(|error| error.to_string())?
        .get()
        .map_err(|error| error.to_string())?;

    let mut bytes = vec![0u8; size as usize];
    reader
        .ReadBytes(&mut bytes)
        .map_err(|error| error.to_string())?;

    Ok(bytes)
}

#[cfg(not(windows))]
fn synthesize_text_to_wav(
    _text: &str,
    _voice_id: Option<&str>,
    _rate: f64,
    _volume: f64,
    _pitch: f64,
) -> Result<Vec<u8>, String> {
    Err("WinRT speech synthesis is only available on Windows.".to_string())
}

fn compact_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();

    if value.chars().count() > max_chars {
        truncated.push_str("...");
    }

    truncated
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(2048).any(|byte| *byte == 0)
}

fn emit_progress(
    app: &tauri::AppHandle,
    request_id: &str,
    stage: &str,
    message: &str,
    tone: &str,
    detail: Option<String>,
) -> Result<(), String> {
    app.emit(
        "assistant-progress",
        AssistantProgressEvent {
            request_id: request_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            tone: tone.to_string(),
            detail,
        },
    )
    .map_err(|error| format!("Could not emit assistant progress event: {error}"))
}

fn should_use_web_search(prompt: &str) -> bool {
    let normalized = prompt.to_lowercase();
    let triggers = [
        "latest",
        "current",
        "today",
        "news",
        "weather",
        "forecast",
        "price",
        "stock",
        "score",
        "release",
        "version",
        "look up",
        "search",
        "recent",
        // Date / time awareness — model training data is stale
        "what day",
        "what date",
        "what's the date",
        "what is the date",
        "which day",
        "what time",
        "what year",
        "what month",
        // Media / entertainment — model hallucinates recent titles
        "movie",
        "film",
        "series",
        "episode",
        "album",
        "song",
        "singer",
        "actor",
        "actress",
        "director",
        "trailer",
        "sequel",
        "prequel",
        "review",
    ];

    triggers.iter().any(|trigger| normalized.contains(trigger))
}

fn is_pure_date_query(prompt: &str) -> bool {
    let normalized = prompt.to_lowercase();
    let patterns = [
        "what day",
        "what date",
        "what's the date",
        "what is the date",
        "which day",
        "what time is it",
        "what year is it",
        "what month is it",
        "today's date",
        "todays date",
        "current date",
        "current time",
    ];
    patterns.iter().any(|p| normalized.contains(p))
}

fn resolve_tool_mode(
    requested_mode: Option<&str>,
    prompt: &str,
    file_path: Option<&str>,
) -> Result<String, String> {
    let mode = requested_mode.unwrap_or("auto");

    match mode {
        "auto" => {
            if file_path.is_some_and(|path| !path.trim().is_empty()) {
                Ok("file".to_string())
            } else if should_use_web_search(prompt) {
                Ok("web".to_string())
            } else {
                Ok("chat".to_string())
            }
        }
        "chat" | "web" => Ok(mode.to_string()),
        "file" => {
            if file_path.is_some_and(|path| !path.trim().is_empty()) {
                Ok("file".to_string())
            } else {
                Err("File mode requires a file path.".to_string())
            }
        }
        _ => Err(format!("Unsupported tool mode `{mode}`.")),
    }
}

async fn fetch_web_evidence(
    client: &Client,
    config: &RuntimeConfig,
    prompt: &str,
) -> Result<ToolEvidence, String> {
    let response = client
        .get(&config.searxng_url)
        .query(&[
            ("q", prompt),
            ("format", "json"),
            ("language", "en-US"),
            ("safesearch", "0"),
        ])
        .send()
        .await
        .map_err(|error| format!("Web search request failed: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        return Err(format!(
            "Search endpoint returned HTTP {} from {}",
            status.as_u16(),
            config.searxng_url
        ));
    }

    let payload = response
        .json::<SearxngSearchResponse>()
        .await
        .map_err(|error| format!("Could not decode search response: {error}"))?;

    let selected_results = payload
        .results
        .into_iter()
        .filter(|result| !result.title.trim().is_empty() && !result.url.trim().is_empty())
        .take(MAX_SEARCH_RESULTS)
        .collect::<Vec<_>>();

    if selected_results.is_empty() {
        return Err("Search did not return any usable results.".to_string());
    }

    let context = selected_results
        .iter()
        .enumerate()
        .map(|(index, result)| {
            let title = compact_whitespace(&result.title);
            let content = truncate_chars(
                &compact_whitespace(&result.content),
                MAX_SEARCH_SNIPPET_CHARS,
            );

            format!(
                "[{}] {}\nURL: {}\nEngine: {}\nSnippet: {}",
                index + 1,
                title,
                result.url,
                result.engine.as_deref().unwrap_or("unknown"),
                if content.is_empty() {
                    "No snippet returned.".to_string()
                } else {
                    content
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(ToolEvidence {
        mode: "web".to_string(),
        detail: format!("{} web result(s)", selected_results.len()),
        trusted_context: format!(
            "Web search evidence for query `{prompt}`:\n{context}\n\nUse this evidence for current facts instead of model memory. If the evidence is incomplete, say so plainly."
        ),
    })
}

fn read_file_evidence(file_path: &str) -> Result<ToolEvidence, String> {
    let requested_path = PathBuf::from(file_path);
    let resolved_path = if requested_path.is_absolute() {
        requested_path
    } else {
        env::current_dir()
            .map_err(|error| format!("Could not resolve current directory: {error}"))?
            .join(requested_path)
    };

    let canonical_path = fs::canonicalize(&resolved_path)
        .map_err(|error| format!("Could not open file `{}`: {error}", resolved_path.display()))?;

    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        format!(
            "Could not read metadata for `{}`: {error}",
            canonical_path.display()
        )
    })?;

    if !metadata.is_file() {
        return Err(format!("`{}` is not a file.", canonical_path.display()));
    }

    let bytes = fs::read(&canonical_path)
        .map_err(|error| format!("Could not read `{}`: {error}", canonical_path.display()))?;
    let slice_len = bytes.len().min(MAX_FILE_BYTES);
    let slice = &bytes[..slice_len];

    if looks_binary(slice) {
        return Err(format!(
            "`{}` does not look like a plain-text file.",
            canonical_path.display()
        ));
    }

    let content = String::from_utf8_lossy(slice);
    let excerpt = truncate_chars(&content, MAX_FILE_CHARS);
    let truncation_note = if bytes.len() > MAX_FILE_BYTES {
        format!(
            "The file exceeded {} bytes, so only the leading excerpt is included.",
            MAX_FILE_BYTES
        )
    } else {
        "The excerpt below includes the full file contents.".to_string()
    };

    Ok(ToolEvidence {
        mode: "file".to_string(),
        detail: canonical_path.display().to_string(),
        trusted_context: format!(
            "Local file evidence:\nFile path: {}\n{}\n\nFile excerpt:\n{}\n\nAnswer from this excerpt when it is relevant. If it does not contain the answer, say so directly.",
            canonical_path.display(),
            truncation_note,
            excerpt
        ),
    })
}

fn resolve_whisper_binary_path(config: &RuntimeConfig) -> Option<PathBuf> {
    let configured = config.whisper_cpp_path.trim();

    if !configured.is_empty() {
        let configured_path = PathBuf::from(configured);

        if configured_path.is_dir() {
            let candidates = if cfg!(windows) {
                ["whisper-cli.exe", "main.exe"]
            } else {
                ["whisper-cli", "main"]
            };

            for candidate in candidates {
                let candidate_path = configured_path.join(candidate);
                if candidate_path.is_file() {
                    return Some(candidate_path);
                }
            }

            return None;
        }

        if configured_path.is_file() {
            return Some(configured_path);
        }
    }

    let candidates: &[&str] = if cfg!(windows) {
        &["whisper-cli.exe", "whisper-cli"]
    } else {
        &["whisper-cli"]
    };

    let path_entries = env::var_os("PATH")?;

    for entry in env::split_paths(&path_entries) {
        for candidate in candidates {
            let candidate_path = entry.join(candidate);
            if candidate_path.is_file() {
                return Some(candidate_path);
            }
        }
    }

    None
}

fn resolve_whisper_model_path(config: &RuntimeConfig) -> Option<PathBuf> {
    let configured = config.whisper_model_path.trim();

    if configured.is_empty() {
        return None;
    }

    let path = PathBuf::from(configured);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn transcription_workspace_dir() -> Result<PathBuf, String> {
    let directory = env::temp_dir().join("ai-assistant-stt");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create STT temp directory: {error}"))?;
    Ok(directory)
}

fn next_transcription_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    format!("stt-{millis}")
}

fn compact_transcription_text(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn transcribe_with_whisper_cpp(
    config: &RuntimeConfig,
    request: &TranscribeAudioRequest,
) -> Result<TranscribeAudioResponse, String> {
    let binary_path = resolve_whisper_binary_path(config).ok_or_else(|| {
        "whisper.cpp executable was not found. Set WHISPER_CPP_PATH to whisper-cli.exe or its directory.".to_string()
    })?;
    let model_path = resolve_whisper_model_path(config).ok_or_else(|| {
        "whisper.cpp model was not found. Set WHISPER_MODEL_PATH to a local ggml Whisper model."
            .to_string()
    })?;

    if request.audio_bytes.is_empty() {
        return Err("No recorded audio was provided for transcription.".to_string());
    }

    let language = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(config.stt_language.as_str())
        .to_string();
    let workspace = transcription_workspace_dir()?;
    let job_id = next_transcription_id();
    let input_path = workspace.join(format!("{job_id}.wav"));
    let output_base = workspace.join(format!("{job_id}-transcript"));
    let output_txt_path = workspace.join(format!("{job_id}-transcript.txt"));

    fs::write(&input_path, &request.audio_bytes)
        .map_err(|error| format!("Could not write the recorded audio file: {error}"))?;

    let mut command = Command::new(&binary_path);
    command
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(&input_path)
        .arg("-l")
        .arg(language.as_str())
        .arg("-t")
        .arg(config.stt_threads.to_string())
        .arg("-nt")
        .arg("-np")
        .arg("-otxt")
        .arg("-of")
        .arg(&output_base);

    if let Some(prompt) = request
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        command.arg("--prompt").arg(prompt);
    }

    let output = command
        .output()
        .map_err(|error| format!("Could not launch whisper.cpp: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let _ = fs::remove_file(&input_path);
        let _ = fs::remove_file(&output_txt_path);
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "whisper.cpp exited with a non-zero status.".to_string()
        };

        return Err(format!("whisper.cpp transcription failed. {detail}"));
    }

    let transcript_source = fs::read_to_string(&output_txt_path).unwrap_or(stdout);
    let transcript = compact_transcription_text(&transcript_source);

    let _ = fs::remove_file(&input_path);
    let _ = fs::remove_file(&output_txt_path);

    if transcript.is_empty() {
        return Err("whisper.cpp did not return any transcript. Try speaking a little longer or increasing mic input.".to_string());
    }

    Ok(TranscribeAudioResponse {
        text: transcript,
        backend: config.stt_backend.clone(),
        language,
    })
}

async fn fetch_models_response(
    client: &Client,
    config: &RuntimeConfig,
) -> Result<ModelsResponse, String> {
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

    response
        .json::<ModelsResponse>()
        .await
        .map_err(|error| format!("Could not decode models response: {error}"))
}

async fn fetch_control_state_response(
    client: &Client,
    config: &RuntimeConfig,
) -> Result<ControlStateApiResponse, String> {
    let response = client
        .get(&config.llm_control_models_endpoint)
        .send()
        .await
        .map_err(|error| format!("Control API request failed: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        return Err(format!(
            "Control models endpoint returned HTTP {} from {}",
            status.as_u16(),
            config.llm_control_models_endpoint
        ));
    }

    response
        .json::<ControlStateApiResponse>()
        .await
        .map_err(|error| format!("Could not decode control models response: {error}"))
}

fn map_control_state(response: ControlStateApiResponse) -> ControlState {
    ControlState {
        ready: response.ready,
        current_alias: response.current_alias,
        default_alias: response.default_alias,
        backup_alias: response.backup_alias,
        current_model: response.current_model,
        live_model: response.live_model,
        configured_model: response.configured_model,
        models: response
            .models
            .unwrap_or_default()
            .into_iter()
            .map(|model| ControlModelProfile {
                alias: model.alias,
                model: model.model,
                role: model.role.unwrap_or_else(|| "alternate".to_string()),
                ui_tier: model.ui_tier.unwrap_or_else(|| "alternate".to_string()),
                recommended: model.recommended.unwrap_or(false),
                client_prompt_prefix: model.client_prompt_prefix.unwrap_or_default(),
                note: model.note.unwrap_or_default(),
                active: model.active.unwrap_or(false),
            })
            .collect(),
    }
}

fn first_model_id(models: &ModelsResponse) -> Option<String> {
    models.data.first().map(|model| model.id.clone())
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

fn load_conversation_summary(
    settings: &tauri::State<'_, SettingsState>,
    conversation_id: Option<i64>,
) -> Result<Option<String>, String> {
    if let Some(conv_id) = conversation_id {
        let conn = settings
            .conn
            .lock()
            .map_err(|_| "Could not acquire DB lock.".to_string())?;

        Ok(conn
            .query_row(
                "SELECT summary FROM conversations WHERE id = ?1",
                params![conv_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
            .filter(|summary| !summary.trim().is_empty()))
    } else {
        Ok(None)
    }
}

fn build_fallback_trusted_context(
    prompt: &str,
    resolved_tool_mode: &str,
    current_date: Option<&str>,
    trusted_context: Option<&str>,
) -> Option<String> {
    if trusted_context.is_some_and(|value| !value.trim().is_empty()) {
        return trusted_context.map(|value| value.trim().to_string());
    }

    if is_pure_date_query(prompt) {
        return None;
    }

    if (resolved_tool_mode == "web" || should_use_web_search(prompt))
        && current_date.is_some_and(|value| !value.trim().is_empty())
    {
        return current_date.map(|value| {
            format!(
                "Current local date/time from the user's device (authoritative): {}.",
                value.trim()
            )
        });
    }

    None
}

fn build_personality_guidance(preset: &str, custom: &str) -> Option<String> {
    let normalized_preset = preset.trim().to_lowercase();
    let preset_guidance = match normalized_preset.as_str() {
        "" | "balanced" => Some(
            "Personality style: calm, clear, helpful, and concise. Avoid sounding robotic or overly theatrical."
                .to_string(),
        ),
        "calm" => Some(
            "Personality style: calm, steady, and reassuring. Keep replies brief, grounded, and low-drama."
                .to_string(),
        ),
        "direct" => Some(
            "Personality style: direct, efficient, and practical. Prefer short answers and concrete next steps."
                .to_string(),
        ),
        "playful" => Some(
            "Personality style: lightly playful and warm without being cheesy. Stay useful first and keep jokes restrained."
                .to_string(),
        ),
        "custom" => None,
        _ => Some(format!(
            "Personality style: {}. Keep it useful, concise, and grounded.",
            preset.trim()
        )),
    };
    let custom_guidance = custom.trim();

    match (preset_guidance, custom_guidance.is_empty()) {
        (Some(preset_text), true) => Some(preset_text),
        (Some(preset_text), false) => Some(format!(
            "{preset_text}\nAdditional personality guidance:\n{custom_guidance}"
        )),
        (None, false) => Some(format!("Custom personality guidance:\n{custom_guidance}")),
        (None, true) => None,
    }
}

fn build_system_prompt_with_context(
    base_system_prompt: &str,
    personality_guidance: Option<&str>,
    conversation_summary: Option<&str>,
    trusted_context_blocks: &[String],
) -> String {
    let mut sections = Vec::new();

    if !base_system_prompt.trim().is_empty() {
        sections.push(base_system_prompt.trim().to_string());
    }

    if let Some(personality) = personality_guidance.filter(|value| !value.trim().is_empty()) {
        sections.push(personality.trim().to_string());
    }

    if !trusted_context_blocks.is_empty() {
        sections.push(format!(
            "Trusted context:\n{}",
            trusted_context_blocks.join("\n\n")
        ));
    }

    if let Some(summary) = conversation_summary.filter(|value| !value.trim().is_empty()) {
        sections.push(format!("Conversation summary:\n{}", summary.trim()));
    }

    sections.join("\n\n")
}

fn build_upstream_messages(
    base_system_prompt: &str,
    personality_guidance: Option<&str>,
    conversation_summary: Option<&str>,
    trusted_context_blocks: &[String],
    recent_messages: Vec<ChatMessage>,
) -> Vec<ChatMessage> {
    let mut messages = Vec::new();
    let system_prompt = build_system_prompt_with_context(
        base_system_prompt,
        personality_guidance,
        conversation_summary,
        trusted_context_blocks,
    );

    if !system_prompt.trim().is_empty() {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        });
    }

    messages.extend(recent_messages);
    messages
}

#[tauri::command]
fn get_runtime_config(settings: tauri::State<'_, SettingsState>) -> RuntimeConfig {
    settings.build_config()
}

#[tauri::command]
async fn check_backend(settings: tauri::State<'_, SettingsState>) -> Result<BackendStatus, String> {
    let config = settings.build_config();
    let client = build_http_client(config.llm_timeout_ms)?;
    let started = std::time::Instant::now();
    let models = fetch_models_response(&client, &config).await?;

    Ok(BackendStatus {
        ok: true,
        model_count: models.data.len(),
        latency_ms: started.elapsed().as_millis(),
        endpoint: config.llm_models_endpoint,
        active_model: first_model_id(&models),
    })
}

#[tauri::command]
async fn list_models(settings: tauri::State<'_, SettingsState>) -> Result<Vec<String>, String> {
    let config = settings.build_config();
    let client = build_http_client(config.llm_timeout_ms)?;
    let models = fetch_models_response(&client, &config).await?;

    Ok(models.data.into_iter().map(|model| model.id).collect())
}

#[tauri::command]
async fn get_control_state(
    settings: tauri::State<'_, SettingsState>,
) -> Result<ControlState, String> {
    let config = settings.build_config();
    let client = build_http_client(config.llm_timeout_ms)?;
    let response = fetch_control_state_response(&client, &config).await?;

    Ok(map_control_state(response))
}

#[tauri::command]
async fn switch_model(
    settings: tauri::State<'_, SettingsState>,
    alias: String,
) -> Result<SwitchModelResponse, String> {
    let config = settings.build_config();
    let client = build_http_client(config.llm_timeout_ms)?;
    let response = client
        .post(&config.llm_control_switch_endpoint)
        .json(&serde_json::json!({ "alias": alias }))
        .send()
        .await
        .map_err(|error| format!("Control switch request failed: {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Control switch endpoint returned HTTP {} from {}. {}",
            status.as_u16(),
            config.llm_control_switch_endpoint,
            body
        ));
    }

    let switch_response = response
        .json::<SwitchModelApiResponse>()
        .await
        .map_err(|error| format!("Could not decode control switch response: {error}"))?;

    Ok(SwitchModelResponse {
        ok: switch_response.ok,
        alias: switch_response.switched_to,
        model: switch_response.model,
        client_prompt_prefix: switch_response.client_prompt_prefix.unwrap_or_default(),
        stdout: switch_response.stdout,
    })
}

#[tauri::command]
fn get_tts_status(
    audio: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
) -> Result<TtsStatus, String> {
    let config = settings.build_config();
    let voices = if config.tts_backend == "winrt" {
        list_winrt_voices()?
    } else {
        Vec::new()
    };
    let output_devices = list_audio_devices();
    let state = audio
        .playback
        .lock()
        .map_err(|_| "Could not acquire the TTS playback lock.".to_string())?;

    Ok(TtsStatus {
        available: config.tts_backend == "winrt" && !voices.is_empty(),
        backend: config.tts_backend,
        speaking: state.speaking,
        active_voice: state.current_voice.clone(),
        active_output_device: state.current_output_device.clone(),
        configured_voice: config.tts_voice,
        configured_output_device: config.tts_output_device,
        voices,
        output_devices,
        rate: config.tts_rate,
        volume: config.tts_volume,
        pitch: config.tts_pitch,
    })
}

#[tauri::command]
fn get_stt_status(settings: tauri::State<'_, SettingsState>) -> Result<SttStatus, String> {
    let config = settings.build_config();
    let binary_path = resolve_whisper_binary_path(&config);
    let model_path = resolve_whisper_model_path(&config);
    let ready = config.stt_backend == "whispercpp" && binary_path.is_some() && model_path.is_some();
    let message = if config.stt_backend != "whispercpp" {
        format!(
            "STT backend `{}` is not supported by this build.",
            config.stt_backend
        )
    } else if binary_path.is_none() {
        "Set WHISPER_CPP_PATH to whisper-cli.exe or its directory.".to_string()
    } else if model_path.is_none() {
        "Set WHISPER_MODEL_PATH to a local whisper.cpp model file.".to_string()
    } else {
        "whisper.cpp is ready for local transcription.".to_string()
    };

    Ok(SttStatus {
        available: config.stt_backend == "whispercpp",
        ready,
        backend: config.stt_backend,
        configured_binary_path: config.whisper_cpp_path,
        configured_model_path: config.whisper_model_path,
        language: config.stt_language,
        threads: config.stt_threads,
        message,
    })
}

#[tauri::command]
async fn transcribe_audio(
    settings: tauri::State<'_, SettingsState>,
    request: TranscribeAudioRequest,
) -> Result<TranscribeAudioResponse, String> {
    let config = settings.build_config();

    if config.stt_backend != "whispercpp" {
        return Err(format!(
            "STT backend `{}` is not supported by this build.",
            config.stt_backend
        ));
    }

    tauri::async_runtime::spawn_blocking(move || transcribe_with_whisper_cpp(&config, &request))
        .await
        .map_err(|error| format!("Transcription task failed: {error}"))?
}

#[tauri::command]
async fn speak_text(
    app: tauri::AppHandle,
    audio: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
    request: SpeakTextRequest,
) -> Result<(), String> {
    let config = settings.build_config();

    if config.tts_backend != "winrt" {
        return Err(format!(
            "TTS backend `{}` is not supported by this build.",
            config.tts_backend
        ));
    }

    let text = request.text.trim().to_string();

    if text.is_empty() {
        return Err("Cannot speak an empty message.".to_string());
    }

    let voices = list_winrt_voices()?;

    if voices.is_empty() {
        return Err("No Windows speech voices are available on this machine.".to_string());
    }

    let selected_voice = resolve_voice_selection(
        &voices,
        request.voice_id.as_deref(),
        config.tts_voice.as_str(),
    )
    .ok_or_else(|| "Could not resolve a usable Windows speech voice.".to_string())?;
    let output_devices = list_audio_devices();
    let selected_output_device = resolve_output_device_selection(
        &output_devices,
        request.device_id.as_deref(),
        config.tts_output_device.as_str(),
    );
    let rate = normalize_tts_rate(request.rate.unwrap_or(config.tts_rate));
    let volume = normalize_tts_volume(request.volume.unwrap_or(config.tts_volume));
    let pitch = normalize_tts_pitch(request.pitch.unwrap_or(config.tts_pitch));
    let voice_id = selected_voice.id.clone();
    let voice_name = selected_voice.name.clone();
    let output_device_id = selected_output_device
        .as_ref()
        .map(|device| device.id.clone());
    let output_device_name = selected_output_device
        .as_ref()
        .map(|device| device.name.clone())
        .or_else(default_output_device_name);
    let text_for_synthesis = text.clone();
    let wav = tauri::async_runtime::spawn_blocking(move || {
        synthesize_text_to_wav(
            &text_for_synthesis,
            Some(voice_id.as_str()),
            rate,
            volume,
            pitch,
        )
    })
    .await
    .map_err(|error| format!("Speech synthesis task failed: {error}"))??;

    audio.cancelled.store(true, Ordering::Relaxed);
    let _ = audio.tx.send(AudioCmd::Stop);
    audio.cancelled.store(false, Ordering::Relaxed);

    set_playback_state(
        &audio.playback,
        true,
        Some(voice_name.clone()),
        output_device_name.clone(),
    )?;

    audio
        .tx
        .send(AudioCmd::Speak {
            wav,
            voice_name: Some(voice_name.clone()),
            device_name: output_device_id,
            cancelled: Arc::clone(&audio.cancelled),
        })
        .map_err(|error| format!("Could not start audio playback: {error}"))?;

    emit_tts_state(
        &app,
        "speaking",
        true,
        Some(voice_name),
        output_device_name.clone(),
        "Speaking reply.",
        Some(format!(
            "Output: {} · {:.1}x · {}% · pitch {:+.0}%",
            output_device_name.unwrap_or_else(|| "System default".to_string()),
            rate,
            (volume * 100.0).round(),
            pitch * 50.0
        )),
    )?;

    Ok(())
}

#[tauri::command]
fn stop_tts(app: tauri::AppHandle, audio: tauri::State<'_, AudioState>) -> Result<bool, String> {
    audio.cancelled.store(true, Ordering::Relaxed);
    let (was_speaking, voice, output_device) = {
        let mut state = audio
            .playback
            .lock()
            .map_err(|_| "Could not acquire the TTS playback lock.".to_string())?;
        let snapshot = (
            state.speaking,
            state.current_voice.clone(),
            state.current_output_device.clone(),
        );
        state.speaking = false;
        state.current_voice = None;
        state.current_output_device = None;
        snapshot
    };
    let _ = audio.tx.send(AudioCmd::Stop);

    if was_speaking {
        emit_tts_state(
            &app,
            "idle",
            false,
            voice,
            output_device,
            "Speech stopped.",
            None,
        )?;
    }

    Ok(was_speaking)
}

#[tauri::command]
async fn enqueue_tts(
    audio: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
    request: SpeakTextRequest,
) -> Result<(), String> {
    let config = settings.build_config();

    if config.tts_backend != "winrt" {
        return Err(format!(
            "TTS backend `{}` is not supported by this build.",
            config.tts_backend
        ));
    }

    let text = request.text.trim().to_string();

    if text.is_empty() {
        return Ok(());
    }

    let voices = list_winrt_voices()?;

    if voices.is_empty() {
        return Err("No Windows speech voices are available on this machine.".to_string());
    }

    let selected_voice = resolve_voice_selection(
        &voices,
        request.voice_id.as_deref(),
        config.tts_voice.as_str(),
    )
    .ok_or_else(|| "Could not resolve a usable Windows speech voice.".to_string())?;

    let rate = normalize_tts_rate(request.rate.unwrap_or(config.tts_rate));
    let volume = normalize_tts_volume(request.volume.unwrap_or(config.tts_volume));
    let pitch = normalize_tts_pitch(request.pitch.unwrap_or(config.tts_pitch));
    let voice_id = selected_voice.id.clone();

    let text_for_synthesis = text.clone();
    let wav = tauri::async_runtime::spawn_blocking(move || {
        synthesize_text_to_wav(
            &text_for_synthesis,
            Some(voice_id.as_str()),
            rate,
            volume,
            pitch,
        )
    })
    .await
    .map_err(|error| format!("Enqueue synthesis task failed: {error}"))??;

    audio
        .tx
        .send(AudioCmd::Enqueue { wav })
        .map_err(|error| format!("Could not enqueue audio: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn chat_completion(
    settings: tauri::State<'_, SettingsState>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    let config = settings.build_config();
    let client = build_http_client(config.llm_timeout_ms)?;
    let raw_prompt = request.prompt.clone().unwrap_or_else(|| {
        request
            .messages
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .map(|message| message.content.clone())
            .unwrap_or_default()
    });
    let system_prompt = request
        .system_prompt
        .unwrap_or_else(|| config.assistant_system_prompt.clone());
    let resolved_tool_mode = resolve_tool_mode(
        request.tool_mode.as_deref(),
        &raw_prompt,
        request.file_path.as_deref(),
    )?;
    let conversation_summary = load_conversation_summary(&settings, request.conversation_id)?;
    let personality_guidance = build_personality_guidance(
        &config.assistant_personality_preset,
        &config.assistant_personality_custom,
    );
    let mut trusted_context_blocks = Vec::new();

    if let Some(trusted_context) = build_fallback_trusted_context(
        &raw_prompt,
        resolved_tool_mode.as_str(),
        request.current_date.as_deref(),
        request.trusted_context.as_deref(),
    ) {
        trusted_context_blocks.push(trusted_context);
    }

    let messages = build_upstream_messages(
        &system_prompt,
        personality_guidance.as_deref(),
        conversation_summary.as_deref(),
        &trusted_context_blocks,
        request.messages,
    );

    let resolved_model = if let Some(model) = request.model {
        model
    } else {
        fetch_models_response(&client, &config)
            .await
            .ok()
            .and_then(|models| first_model_id(&models))
            .unwrap_or_else(|| config.llm_model.clone())
    };

    let upstream_request = UpstreamChatRequest {
        model: resolved_model,
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
        tool_mode: None,
        tool_detail: None,
    })
}

#[tauri::command]
async fn chat_completion_stream(
    app: tauri::AppHandle,
    settings: tauri::State<'_, SettingsState>,
    request: ChatRequest,
) -> Result<ChatResponse, String> {
    let config = settings.build_config();
    let conversation_summary = load_conversation_summary(&settings, request.conversation_id)?;
    let client = build_http_client(config.llm_timeout_ms)?;
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| "chat-stream".to_string());
    let requested_tool_mode = request
        .tool_mode
        .clone()
        .unwrap_or_else(|| "auto".to_string());
    let raw_prompt = request.prompt.clone().unwrap_or_else(|| {
        request
            .messages
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .map(|message| message.content.clone())
            .unwrap_or_default()
    });
    let system_prompt = request
        .system_prompt
        .clone()
        .unwrap_or_else(|| config.assistant_system_prompt.clone());

    let resolved_tool_mode = resolve_tool_mode(
        Some(requested_tool_mode.as_str()),
        &raw_prompt,
        request.file_path.as_deref(),
    )?;
    let mut tool_evidence: Option<ToolEvidence> = None;
    let personality_guidance = build_personality_guidance(
        &config.assistant_personality_preset,
        &config.assistant_personality_custom,
    );
    let mut trusted_context_blocks = Vec::new();

    if let Some(trusted_context) = build_fallback_trusted_context(
        &raw_prompt,
        resolved_tool_mode.as_str(),
        request.current_date.as_deref(),
        request.trusted_context.as_deref(),
    ) {
        trusted_context_blocks.push(trusted_context);
    }

    match resolved_tool_mode.as_str() {
        "web" => {
            // For pure date/time queries, skip SearXNG entirely — conflicting snippets
            // cause the small model to blend the correct day name with a wrong date
            // from stale search results. The device clock is the only reliable source.
            let date_only_evidence = if is_pure_date_query(&raw_prompt) {
                request.current_date.as_deref().filter(|d| !d.trim().is_empty()).map(|date| {
                    ToolEvidence {
                        mode: "web".to_string(),
                        detail: "Device clock".to_string(),
                        trusted_context: format!(
                            "Current local date/time from the user's device (authoritative): {date}. Answer date and time questions directly from this without speculation."
                        ),
                    }
                })
            } else {
                None
            };

            if let Some(evidence) = date_only_evidence {
                emit_progress(
                    &app,
                    &request_id,
                    "search-ready",
                    "Date from device clock",
                    "success",
                    Some(evidence.detail.clone()),
                )?;
                trusted_context_blocks.push(evidence.trusted_context.clone());
                tool_evidence = Some(evidence);
            } else {
                emit_progress(
                    &app,
                    &request_id,
                    "search",
                    "Searching the web",
                    "search",
                    Some(config.searxng_url.clone()),
                )?;

                match fetch_web_evidence(&client, &config, &raw_prompt).await {
                    Ok(evidence) => {
                        emit_progress(
                            &app,
                            &request_id,
                            "search-ready",
                            "Grounded with web results",
                            "search",
                            Some(evidence.detail.clone()),
                        )?;
                        trusted_context_blocks.push(evidence.trusted_context.clone());
                        tool_evidence = Some(evidence);
                    }
                    Err(error) if requested_tool_mode == "auto" => {
                        emit_progress(
                            &app,
                            &request_id,
                            "search-skipped",
                            "Web search unavailable, continuing without it",
                            "warning",
                            Some(error),
                        )?;
                    }
                    Err(error) => return Err(error),
                }
            } // else (not a pure date query)
        }
        "file" => {
            let file_path = request
                .file_path
                .as_deref()
                .ok_or_else(|| "File mode requires a file path.".to_string())?;

            emit_progress(
                &app,
                &request_id,
                "file-read",
                "Reading local file",
                "file",
                Some(file_path.to_string()),
            )?;

            let evidence = read_file_evidence(file_path)?;

            emit_progress(
                &app,
                &request_id,
                "file-ready",
                "Grounded with file contents",
                "file",
                Some(evidence.detail.clone()),
            )?;
            trusted_context_blocks.push(evidence.trusted_context.clone());
            tool_evidence = Some(evidence);
        }
        _ => {}
    }
    let messages = build_upstream_messages(
        &system_prompt,
        personality_guidance.as_deref(),
        conversation_summary.as_deref(),
        &trusted_context_blocks,
        request.messages.clone(),
    );

    let resolved_model = if let Some(model) = request.model.clone() {
        model
    } else {
        fetch_models_response(&client, &config)
            .await
            .ok()
            .and_then(|models| first_model_id(&models))
            .unwrap_or_else(|| config.llm_model.clone())
    };

    let upstream_request = UpstreamChatRequest {
        model: resolved_model,
        messages,
        max_tokens: request.max_tokens.unwrap_or(192),
        temperature: request.temperature.unwrap_or(0.35),
        stream: true,
    };

    emit_progress(
        &app,
        &request_id,
        "generation",
        "Generating reply from the Pi",
        "generation",
        Some(upstream_request.model.clone()),
    )?;

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

    let mut stream_buffer = String::new();
    let mut full_content = String::new();
    let mut streamed_model: Option<String> = None;
    let mut response = response;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Streaming chat response failed: {error}"))?
    {
        stream_buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_index) = stream_buffer.find('\n') {
            let line = stream_buffer[..newline_index]
                .trim_end_matches('\r')
                .to_string();
            stream_buffer = stream_buffer[newline_index + 1..].to_string();

            if !line.starts_with("data: ") {
                continue;
            }

            let payload = &line[6..];

            if payload == "[DONE]" {
                break;
            }

            if payload.is_empty() {
                continue;
            }

            let chunk = serde_json::from_str::<ChatCompletionChunk>(payload)
                .map_err(|error| format!("Could not decode streaming chat chunk: {error}"))?;

            if let Some(model) = chunk.model.clone() {
                streamed_model = Some(model);
            }

            let delta = chunk
                .choices
                .first()
                .and_then(|choice| choice.delta.content.clone());

            if let Some(delta) = delta {
                full_content.push_str(&delta);

                app.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        request_id: request_id.clone(),
                        delta: Some(delta),
                        model: streamed_model.clone(),
                        done: false,
                    },
                )
                .map_err(|error| format!("Could not emit chat stream event: {error}"))?;
            }
        }
    }

    app.emit(
        "chat-stream",
        ChatStreamEvent {
            request_id: request_id.clone(),
            delta: None,
            model: streamed_model.clone(),
            done: true,
        },
    )
    .map_err(|error| format!("Could not emit chat stream completion event: {error}"))?;

    if full_content.trim().is_empty() {
        return Err("Chat response did not include assistant text".to_string());
    }

    emit_progress(
        &app,
        &request_id,
        "done",
        "Reply ready",
        "success",
        tool_evidence
            .as_ref()
            .map(|evidence| evidence.detail.clone()),
    )?;

    Ok(ChatResponse {
        content: full_content,
        model: streamed_model.unwrap_or_else(|| upstream_request.model.to_string()),
        tool_mode: tool_evidence.as_ref().map(|evidence| evidence.mode.clone()),
        tool_detail: tool_evidence
            .as_ref()
            .map(|evidence| evidence.detail.clone()),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedMessage {
    id: i64,
    conversation_id: i64,
    role: String,
    content: String,
    meta: Option<String>,
    tool_mode: Option<String>,
    include_in_context: bool,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSummary {
    id: i64,
    started_at: String,
    title: Option<String>,
    message_count: i64,
}

#[tauri::command]
fn create_conversation(settings: tauri::State<'_, SettingsState>) -> Result<i64, String> {
    let conn = settings
        .conn
        .lock()
        .map_err(|_| "Could not acquire DB lock.".to_string())?;

    conn.execute("INSERT INTO conversations DEFAULT VALUES", [])
        .map_err(|error| format!("Could not create conversation: {error}"))?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn append_message(
    settings: tauri::State<'_, SettingsState>,
    conversation_id: i64,
    role: String,
    content: String,
    meta: Option<String>,
    tool_mode: Option<String>,
    include_in_context: bool,
) -> Result<i64, String> {
    let conn = settings
        .conn
        .lock()
        .map_err(|_| "Could not acquire DB lock.".to_string())?;

    conn.execute(
        "INSERT INTO chat_messages (conversation_id, role, content, meta, tool_mode, include_in_context)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![conversation_id, role, content, meta, tool_mode, include_in_context as i32],
    )
    .map_err(|error| format!("Could not persist message: {error}"))?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_conversation(
    settings: tauri::State<'_, SettingsState>,
    conversation_id: i64,
) -> Result<Vec<PersistedMessage>, String> {
    let conn = settings
        .conn
        .lock()
        .map_err(|_| "Could not acquire DB lock.".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, meta, tool_mode, include_in_context, created_at
             FROM chat_messages WHERE conversation_id = ?1 ORDER BY id ASC",
        )
        .map_err(|error| format!("Could not query conversation: {error}"))?;

    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(PersistedMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                meta: row.get(4)?,
                tool_mode: row.get(5)?,
                include_in_context: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
            })
        })
        .map_err(|error| format!("Could not read conversation rows: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not collect conversation rows: {error}"))
}

#[tauri::command]
fn list_conversations(
    settings: tauri::State<'_, SettingsState>,
) -> Result<Vec<ConversationSummary>, String> {
    let conn = settings
        .conn
        .lock()
        .map_err(|_| "Could not acquire DB lock.".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.started_at, c.title, COUNT(m.id) as message_count
             FROM conversations c
             LEFT JOIN chat_messages m ON m.conversation_id = c.id
             GROUP BY c.id ORDER BY c.id DESC LIMIT 50",
        )
        .map_err(|error| format!("Could not query conversations: {error}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                started_at: row.get(1)?,
                title: row.get(2)?,
                message_count: row.get(3)?,
            })
        })
        .map_err(|error| format!("Could not read conversation list: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not collect conversation list: {error}"))
}

/// Summarize the conversation stored in the DB and persist the result.
/// Fetches all context-eligible messages, calls the LLM with a compact
/// summarization prompt, and writes the summary back to `conversations.summary`.
#[tauri::command]
async fn summarize_conversation(
    settings: tauri::State<'_, SettingsState>,
    conversation_id: i64,
) -> Result<String, String> {
    // --- Phase 1: read data while holding the DB lock briefly ---
    let config = settings.build_config();

    let transcript = {
        let conn = settings
            .conn
            .lock()
            .map_err(|_| "Could not acquire DB lock.".to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT role, content FROM chat_messages
                 WHERE conversation_id = ?1 AND include_in_context = 1
                 ORDER BY id ASC",
            )
            .map_err(|error| format!("Could not query messages: {error}"))?;

        let pairs: Vec<(String, String)> = stmt
            .query_map(params![conversation_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("Could not read messages: {error}"))?
            .filter_map(|r| r.ok())
            .collect();

        pairs
            .iter()
            .map(|(role, content)| {
                let label = match role.as_str() {
                    "user" => "User",
                    "assistant" => "Assistant",
                    _ => "System",
                };
                // Truncate very long messages so the summarization prompt stays compact.
                let body = truncate_chars(content, 400);
                format!("{label}: {body}")
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }; // DB lock released here

    if transcript.trim().is_empty() {
        return Err("No messages to summarize.".to_string());
    }

    // --- Phase 2: call the LLM (async, no lock held) ---
    let client = build_http_client(config.llm_timeout_ms)?;

    let system_prompt = "You are a conversation summarizer. \
        Produce a single concise paragraph (3–5 sentences) that captures: \
        the main topics discussed, key facts or preferences the user stated, \
        and any decisions reached. \
        Write only the summary — no preamble, no labels.";

    let upstream = UpstreamChatRequest {
        model: config.llm_model.clone(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: format!("Conversation:\n\n{transcript}"),
            },
        ],
        max_tokens: 300,
        temperature: 0.15,
        stream: false,
    };

    let response = client
        .post(&config.llm_chat_endpoint)
        .json(&upstream)
        .send()
        .await
        .map_err(|error| format!("Summarization request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Summarization endpoint returned HTTP {status}. {body}"
        ));
    }

    let completion = response
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|error| format!("Could not decode summarization response: {error}"))?;

    let summary = completion
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .and_then(extract_text_content)
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "Summarization response contained no text.".to_string())?;

    // --- Phase 3: persist the summary ---
    {
        let conn = settings
            .conn
            .lock()
            .map_err(|_| "Could not acquire DB lock.".to_string())?;

        conn.execute(
            "UPDATE conversations SET summary = ?1 WHERE id = ?2",
            params![summary, conversation_id],
        )
        .map_err(|error| format!("Could not store summary: {error}"))?;
    }

    Ok(summary)
}

#[tauri::command]
fn get_settings(settings: tauri::State<'_, SettingsState>) -> HashMap<String, String> {
    settings.all()
}

#[tauri::command]
fn save_settings(
    settings: tauri::State<'_, SettingsState>,
    values: HashMap<String, String>,
) -> Result<(), String> {
    let conn = settings
        .conn
        .lock()
        .map_err(|_| "Could not acquire settings DB lock.".to_string())?;

    for (key, value) in &values {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|error| format!("Could not save setting `{key}`: {error}"))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    let playback = Arc::new(Mutex::new(TtsPlaybackState {
        speaking: false,
        current_voice: None,
        current_output_device: None,
    }));

    tauri::Builder::default()
        .setup({
            let playback = Arc::clone(&playback);

            move |app| {
                let conn = init_settings_db(app.handle())
                    .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
                app.manage(SettingsState {
                    conn: Mutex::new(conn),
                });

                let tx = spawn_audio_thread(app.handle().clone(), Arc::clone(&playback));
                app.manage(AudioState {
                    tx,
                    cancelled: Arc::new(AtomicBool::new(false)),
                    playback: Arc::clone(&playback),
                });

                // ── System tray ─────────────────────────────────────────────
                let show_item =
                    MenuItem::with_id(app, "show", "Show AI Assistant", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("AI Assistant")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;

                // ── Close-to-tray ────────────────────────────────────────────
                // Intercept the window close event so clicking × hides rather
                // than exits. The tray "Quit" item (or OS shutdown) exits normally.
                if let Some(main_window) = app.get_webview_window("main") {
                    let win = main_window.clone();
                    main_window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = win.hide();
                        }
                    });
                }

                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_config,
            check_backend,
            list_models,
            get_control_state,
            switch_model,
            get_tts_status,
            get_stt_status,
            speak_text,
            stop_tts,
            enqueue_tts,
            transcribe_audio,
            chat_completion,
            chat_completion_stream,
            get_settings,
            save_settings,
            create_conversation,
            append_message,
            get_conversation,
            list_conversations,
            summarize_conversation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
