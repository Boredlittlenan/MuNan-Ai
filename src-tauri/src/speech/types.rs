use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct TranscribeAudioRequest {
    pub audio_base64: String,
    pub mime_type: String,
    pub language: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TranscribeAudioResponse {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct SynthesizeSpeechRequest {
    pub text: String,
    pub voice: Option<String>,
    pub voice_description: Option<String>,
    pub format: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SynthesizeSpeechResponse {
    pub audio_base64: String,
    pub mime_type: String,
}
