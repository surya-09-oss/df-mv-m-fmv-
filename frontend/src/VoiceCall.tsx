import { useState, useRef, useEffect, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Globe, Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "";

interface SpeechRecognitionEvent {
  results: { [key: number]: { [key: number]: { transcript: string; confidence: number }; isFinal?: boolean } };
  resultIndex: number;
}

type CallState = "idle" | "listening" | "processing" | "speaking";

interface VoiceCallProps {
  onClose: () => void;
}

export default function VoiceCall({ onClose }: VoiceCallProps) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callActive, setCallActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [selectedVoice, setSelectedVoice] = useState("en-female");
  const [callDuration, setCallDuration] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callActiveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef("");

  const voices = [
    { id: "en-female", name: "Jenny (English)", language: "en" },
    { id: "en-male", name: "Guy (English)", language: "en" },
    { id: "en-female-aria", name: "Aria (English)", language: "en" },
    { id: "en-female-sara", name: "Sara (English)", language: "en" },
    { id: "en-male-davis", name: "Davis (English)", language: "en" },
    { id: "en-male-tony", name: "Tony (English)", language: "en" },
    { id: "hi-female", name: "Swara (Hindi)", language: "hi" },
    { id: "hi-male", name: "Madhur (Hindi)", language: "hi" },
  ];

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || !callActiveRef.current) return;
    setCallState("listening");
    setTranscript("");
    transcriptRef.current = "";
    try {
      recognitionRef.current.start();
    } catch {
      /* already started */
    }
  }, []);

  const playAudioAndResume = useCallback(
    async (audioBase64: string) => {
      if (!callActiveRef.current) return;
      setCallState("speaking");

      try {
        stopAudio();
        const audioBlob = new Blob(
          [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
          { type: "audio/mpeg" }
        );
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          if (callActiveRef.current) {
            setTimeout(() => startListening(), 400);
          }
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
          if (callActiveRef.current) {
            setTimeout(() => startListening(), 400);
          }
        };
        await audio.play();
      } catch (err) {
        console.error("Audio playback failed:", err);
        if (callActiveRef.current) {
          setTimeout(() => startListening(), 400);
        }
      }
    },
    [stopAudio, startListening]
  );

  const sendToAI = useCallback(
    async (text: string) => {
      if (!text.trim() || !callActiveRef.current) return;
      setCallState("processing");
      setAiResponse("");

      try {
        const res = await fetch(`${API_URL}/api/chat-and-speak`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversation_id: conversationId,
            language: selectedLanguage,
            voice: selectedVoice,
          }),
        });

        if (!res.ok) throw new Error("API failed");
        const data = await res.json();

        setAiResponse(data.reply);
        setConversationId(data.conversation_id);

        if (data.audio_base64 && callActiveRef.current) {
          await playAudioAndResume(data.audio_base64);
        } else if (callActiveRef.current) {
          setTimeout(() => startListening(), 500);
        }
      } catch (err) {
        console.error("AI call failed:", err);
        setAiResponse("Sorry, I couldn't connect. Let me try listening again...");
        if (callActiveRef.current) {
          setTimeout(() => startListening(), 1500);
        }
      }
    },
    [conversationId, selectedLanguage, selectedVoice, playAudioAndResume, startListening]
  );

  // Initialize speech recognition
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = selectedLanguage === "hi" ? "hi-IN" : "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < Object.keys(event.results).length; i++) {
        const result = event.results[i];
        if (result) {
          const text = result[0].transcript;
          if (result.isFinal) {
            finalText += text;
          } else {
            interimText += text;
          }
        }
      }
      if (finalText) {
        transcriptRef.current = finalText;
        setTranscript(finalText);
      } else if (interimText) {
        setTranscript(interimText);
      }
    };

    recognition.onend = () => {
      const text = transcriptRef.current.trim();
      if (text && callActiveRef.current) {
        sendToAI(text);
      } else if (callActiveRef.current) {
        setTimeout(() => startListening(), 300);
      }
    };

    recognition.onerror = () => {
      if (callActiveRef.current) {
        setTimeout(() => startListening(), 500);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, [selectedLanguage, sendToAI, startListening]);

  const startCall = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in your browser. Please use Chrome.");
      return;
    }

    setCallActive(true);
    callActiveRef.current = true;
    setCallDuration(0);
    setTranscript("");
    setAiResponse("");

    timerRef.current = setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);

    setTimeout(() => startListening(), 500);
  };

  const endCall = useCallback(() => {
    callActiveRef.current = false;
    setCallActive(false);
    setCallState("idle");
    setTranscript("");

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    stopAudio();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (conversationId) {
      fetch(`${API_URL}/api/conversation/${conversationId}`, { method: "DELETE" }).catch(() => { /* ignore */ });
    }
    setConversationId(null);
    setCallDuration(0);
  }, [stopAudio, conversationId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      callActiveRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
      stopAudio();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [stopAudio]);

  return (
    <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col items-center justify-center">
      {/* Background gradient */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl transition-all duration-1000 ${
            callState === "listening"
              ? "bg-green-500/20 scale-110"
              : callState === "processing"
              ? "bg-yellow-500/15 scale-100"
              : callState === "speaking"
              ? "bg-blue-500/20 scale-125"
              : "bg-purple-500/10 scale-90"
          }`}
        />
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4">
        <button
          onClick={() => {
            if (callActive) endCall();
            onClose();
          }}
          className="text-gray-400 hover:text-white text-sm"
        >
          Back to Chat
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-gray-400 hover:text-white p-2"
        >
          <Globe size={18} />
        </button>
      </div>

      {/* Settings dropdown */}
      {showSettings && (
        <div className="absolute top-14 right-4 bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3 z-10 w-56">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Language</label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={callActive}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none disabled:opacity-50"
            >
              <option value="en">English</option>
              <option value="hi">Hindi / Hinglish</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Voice</label>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              disabled={callActive}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none disabled:opacity-50"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-4 text-center max-w-md">
        {/* Avatar */}
        <div
          className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
            callState === "listening"
              ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-xl shadow-green-500/30"
              : callState === "processing"
              ? "bg-gradient-to-br from-yellow-500 to-orange-600 shadow-xl shadow-yellow-500/30"
              : callState === "speaking"
              ? "bg-gradient-to-br from-blue-500 to-purple-600 shadow-xl shadow-blue-500/30"
              : "bg-gradient-to-br from-gray-700 to-gray-800"
          }`}
        >
          {/* Pulse rings */}
          {callActive && (
            <>
              <div
                className={`absolute inset-0 rounded-full animate-ping opacity-20 ${
                  callState === "listening"
                    ? "bg-green-400"
                    : callState === "speaking"
                    ? "bg-blue-400"
                    : callState === "processing"
                    ? "bg-yellow-400"
                    : "bg-gray-400"
                }`}
              />
              <div
                className={`absolute -inset-3 rounded-full animate-pulse opacity-10 ${
                  callState === "listening"
                    ? "bg-green-400"
                    : callState === "speaking"
                    ? "bg-blue-400"
                    : "bg-gray-400"
                }`}
              />
            </>
          )}

          {callState === "listening" ? (
            <Mic size={48} className="text-white" />
          ) : callState === "processing" ? (
            <Loader2 size={48} className="text-white animate-spin" />
          ) : callState === "speaking" ? (
            <Volume2 size={48} className="text-white" />
          ) : (
            <Phone size={48} className="text-white" />
          )}
        </div>

        {/* Status */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">
            {callActive ? "AI Voice Call" : "Voice Call"}
          </h2>
          <p
            className={`text-sm font-medium ${
              callState === "listening"
                ? "text-green-400"
                : callState === "processing"
                ? "text-yellow-400"
                : callState === "speaking"
                ? "text-blue-400"
                : "text-gray-500"
            }`}
          >
            {callState === "listening"
              ? "Listening to you..."
              : callState === "processing"
              ? "Thinking..."
              : callState === "speaking"
              ? "Speaking..."
              : callActive
              ? "Connected"
              : "Tap to start"}
          </p>
          {callActive && (
            <p className="text-xs text-gray-500 mt-1">{formatDuration(callDuration)}</p>
          )}
        </div>

        {/* Transcript / Response display */}
        {callActive && (
          <div className="w-full min-h-[80px] max-h-[200px] overflow-y-auto">
            {transcript && callState === "listening" && (
              <div className="bg-gray-900/50 rounded-xl px-4 py-3 mb-2">
                <p className="text-xs text-gray-500 mb-1">You:</p>
                <p className="text-sm text-gray-300">{transcript}</p>
              </div>
            )}
            {aiResponse && (callState === "speaking" || callState === "processing") && (
              <div className="bg-gray-900/50 rounded-xl px-4 py-3">
                <p className="text-xs text-blue-400 mb-1">AI:</p>
                <p className="text-sm text-gray-200">{aiResponse}</p>
              </div>
            )}
          </div>
        )}

        {/* Waveform visualization */}
        {callState === "listening" && (
          <div className="flex items-center gap-1 h-8">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-green-400 rounded-full animate-pulse"
                style={{
                  height: `${8 + Math.sin(i * 0.8) * 16 + Math.random() * 8}px`,
                  animationDelay: `${i * 0.1}s`,
                  animationDuration: `${0.4 + Math.random() * 0.4}s`,
                }}
              />
            ))}
          </div>
        )}
        {callState === "speaking" && (
          <div className="flex items-center gap-1 h-8">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-blue-400 rounded-full animate-pulse"
                style={{
                  height: `${8 + Math.cos(i * 0.6) * 16 + Math.random() * 8}px`,
                  animationDelay: `${i * 0.08}s`,
                  animationDuration: `${0.3 + Math.random() * 0.3}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Call controls */}
        <div className="flex items-center gap-6 mt-4">
          {!callActive ? (
            <button
              onClick={startCall}
              className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center shadow-xl shadow-green-500/30 transition-all hover:scale-105 active:scale-95"
            >
              <Phone size={32} className="text-white" />
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  if (callState === "listening" && recognitionRef.current) {
                    try { recognitionRef.current.stop(); } catch { /* ignore */ }
                  }
                }}
                className="w-14 h-14 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-all"
                title={callState === "listening" ? "Stop listening" : "Mic"}
              >
                {callState === "listening" ? (
                  <MicOff size={24} className="text-red-400" />
                ) : (
                  <Mic size={24} className="text-gray-400" />
                )}
              </button>

              <button
                onClick={() => {
                  endCall();
                  onClose();
                }}
                className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-xl shadow-red-500/30 transition-all hover:scale-105 active:scale-95"
              >
                <PhoneOff size={32} className="text-white" />
              </button>

              <button
                onClick={stopAudio}
                className="w-14 h-14 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center transition-all"
                title="Mute speaker"
              >
                <Volume2
                  size={24}
                  className={callState === "speaking" ? "text-blue-400" : "text-gray-400"}
                />
              </button>
            </>
          )}
        </div>

        {!callActive && (
          <p className="text-xs text-gray-600 mt-2">
            Speak naturally — AI will listen, respond with voice, then listen again.
            Free & unlimited via GPT4Free.
          </p>
        )}
      </div>
    </div>
  );
}
