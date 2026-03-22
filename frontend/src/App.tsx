import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Trash2,
  Plus,
  Bot,
  User,
  Settings,
  Globe,
  Loader2,
  Square,
  Phone,
} from "lucide-react";
import VoiceCall from "./VoiceCall";

const API_URL = import.meta.env.VITE_API_URL || "";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  audioBase64?: string | null;
}

interface VoiceOption {
  id: string;
  name: string;
  language: string;
}

// Extend Window for SpeechRecognition
interface SpeechRecognitionEvent {
  results: { [key: number]: { [key: number]: { transcript: string } } };
  resultIndex: number;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState("en-female");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [showSettings, setShowSettings] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputValueRef = useRef(input);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  const voices: VoiceOption[] = [
    { id: "en-female", name: "Jenny (English)", language: "English" },
    { id: "en-male", name: "Guy (English)", language: "English" },
    { id: "hi-female", name: "Swara (Hindi)", language: "Hindi" },
    { id: "hi-male", name: "Madhur (Hindi)", language: "Hindi" },
  ];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    // Initialize speech recognition
    const SpeechRecognition =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      // Set language based on selection
      if (selectedLanguage === "hi") {
        recognition.lang = "hi-IN";
      } else {
        recognition.lang = "en-US";
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < Object.keys(event.results).length; i++) {
          const result = event.results[i];
          if (result) {
            finalTranscript += result[0].transcript;
          }
        }
        if (finalTranscript) {
          setInput(finalTranscript);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      setIsListening(false);
    };
  }, [selectedLanguage]);

  const playAudio = useCallback(
    async (audioBase64: string) => {
      if (!autoSpeak) return;

      try {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }

        const audioBlob = new Blob(
          [
            Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0)),
          ],
          { type: "audio/mpeg" }
        );
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        setIsSpeaking(true);
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        await audio.play();
      } catch (err) {
        setIsSpeaking(false);
        console.error("Audio playback failed:", err);
      }
    },
    [autoSpeak]
  );

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
      setIsSpeaking(false);
    }
  };

  const sendMessage = async (messageText?: string) => {
    const text = messageText || input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const endpoint = autoSpeak ? "/api/chat-and-speak" : "/api/chat";
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          language: selectedLanguage,
        }),
      });

      if (!res.ok) throw new Error("Failed to get response");

      const data = await res.json();

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply,
        audioBase64: data.audio_base64 || null,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setConversationId(data.conversation_id);

      if (data.audio_base64 && autoSpeak) {
        await playAudio(data.audio_base64);
      }
    } catch {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in your browser. Please use Chrome.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      // Auto-send after stopping - use ref to get latest input value
      if (input.trim()) {
        setTimeout(() => {
          const currentInput = inputValueRef.current.trim();
          if (currentInput) sendMessage(currentInput);
        }, 300);
      }
    } else {
      setInput("");
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const startNewChat = async () => {
    if (conversationId) {
      try {
        await fetch(`${API_URL}/api/conversation/${conversationId}`, {
          method: "DELETE",
        });
      } catch {
        // ignore
      }
    }
    setMessages([]);
    setConversationId(null);
    setInput("");
    stopAudio();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const speakMessage = async (text: string) => {
    try {
      const res = await fetch(`${API_URL}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: selectedVoice,
        }),
      });

      if (!res.ok) throw new Error("TTS failed");

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = audio;
      setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      await audio.play();
    } catch (err) {
      console.error("TTS failed:", err);
    }
  };

  if (showVoiceCall) {
    return <VoiceCall onClose={() => setShowVoiceCall(false)} />;
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <div className="hidden md:flex w-64 flex-col bg-gray-900 border-r border-gray-800">
        <div className="p-4">
          <button
            onClick={startNewChat}
            className="flex items-center gap-2 w-full px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider mb-2 px-2">
            <Bot size={14} />
            AI Voice Chatbot
          </div>
        </div>

        {/* Settings Panel */}
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors text-sm text-gray-400"
          >
            <Settings size={16} />
            Settings
          </button>

          {showSettings && (
            <div className="mt-3 space-y-3 bg-gray-800 rounded-xl p-4">
              {/* Language */}
              <div>
                <label className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                  <Globe size={12} />
                  Language
                </label>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi / Hinglish</option>
                </select>
              </div>

              {/* Voice */}
              <div>
                <label className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                  <Volume2 size={12} />
                  Voice
                </label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Auto-speak toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Auto-speak</span>
                <button
                  onClick={() => setAutoSpeak(!autoSpeak)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    autoSpeak ? "bg-blue-500" : "bg-gray-600"
                  }`}
                >
                  <div
                    className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                      autoSpeak ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Bot size={18} />
            </div>
            <div>
              <h1 className="text-sm font-semibold">AI Assistant</h1>
              <p className="text-xs text-gray-500">
                {isLoading
                  ? "Thinking..."
                  : isSpeaking
                  ? "Speaking..."
                  : "Online"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile settings */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="md:hidden p-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Settings size={18} className="text-gray-400" />
            </button>

            {/* Voice Call button */}
            <button
              onClick={() => setShowVoiceCall(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
            >
              <Phone size={14} />
              Voice Call
            </button>

            {/* Voice mode toggle */}
            <button
              onClick={() => setIsVoiceMode(!isVoiceMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isVoiceMode
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-gray-800 text-gray-400 border border-gray-700"
              }`}
            >
              {isVoiceMode ? <Mic size={14} /> : <MicOff size={14} />}
              Voice {isVoiceMode ? "On" : "Off"}
            </button>

            <button
              onClick={startNewChat}
              className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
              title="New chat"
            >
              <Trash2 size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Mobile Settings Panel */}
        {showSettings && (
          <div className="md:hidden bg-gray-900 border-b border-gray-800 p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">Language</label>
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi / Hinglish</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">Voice</label>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Auto-speak responses</span>
              <button
                onClick={() => setAutoSpeak(!autoSpeak)}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  autoSpeak ? "bg-blue-500" : "bg-gray-600"
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                    autoSpeak ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
                <Bot size={32} />
              </div>
              <h2 className="text-2xl font-bold mb-2">
                Hey there! Ready to chat?
              </h2>
              <p className="text-gray-400 max-w-md text-sm leading-relaxed">
                I can talk in English, Hindi, and Hinglish. Type a message,
                click the mic button, or tap <strong>Voice Call</strong> for a
                live voice-to-voice conversation like a phone call!
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {[
                  "Hello! How are you?",
                  "Kya haal hai?",
                  "Tell me a joke",
                  "Mujhe kuch interesting batao",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="px-4 py-2 rounded-full bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors border border-gray-700"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0 mt-1">
                      <Bot size={16} />
                    </div>
                  )}
                  <div
                    className={`max-w-xl rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-100"
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700/50">
                        <button
                          onClick={() => speakMessage(msg.content)}
                          className="p-1 rounded hover:bg-gray-700 transition-colors"
                          title="Listen"
                        >
                          <Volume2 size={14} className="text-gray-400" />
                        </button>
                        {isSpeaking && (
                          <button
                            onClick={stopAudio}
                            className="p-1 rounded hover:bg-gray-700 transition-colors"
                            title="Stop"
                          >
                            <Square size={14} className="text-gray-400" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-1">
                      <User size={16} />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Bot size={16} />
                  </div>
                  <div className="bg-gray-800 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-blue-400" />
                      <span className="text-sm text-gray-400">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-800 bg-gray-900/50 backdrop-blur-sm p-4">
          <div className="max-w-3xl mx-auto">
            {/* Voice indicator */}
            {isListening && (
              <div className="flex items-center justify-center gap-2 mb-3 py-2">
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-red-500 rounded-full animate-pulse"
                      style={{
                        height: `${Math.random() * 20 + 10}px`,
                        animationDelay: `${i * 0.15}s`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm text-red-400 font-medium">
                  Listening...
                </span>
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Mic button */}
              {isVoiceMode && (
                <button
                  onClick={toggleListening}
                  className={`flex-shrink-0 p-3 rounded-xl transition-all ${
                    isListening
                      ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse"
                      : "bg-gray-800 hover:bg-gray-700 text-gray-400"
                  }`}
                >
                  {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
              )}

              {/* Text input */}
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isListening
                      ? "Listening to your voice..."
                      : isVoiceMode
                      ? "Speak or type your message..."
                      : "Type a message..."
                  }
                  rows={1}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none placeholder-gray-500"
                  style={{ minHeight: "48px", maxHeight: "120px" }}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || isLoading}
                  className={`absolute right-2 bottom-2 p-2 rounded-lg transition-all ${
                    input.trim() && !isLoading
                      ? "bg-blue-500 hover:bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-500 cursor-not-allowed"
                  }`}
                >
                  {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </div>

              {/* Speaker toggle */}
              <button
                onClick={() => {
                  if (isSpeaking) stopAudio();
                  setAutoSpeak(!autoSpeak);
                }}
                className={`flex-shrink-0 p-3 rounded-xl transition-all ${
                  autoSpeak
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-gray-800 text-gray-500"
                }`}
                title={autoSpeak ? "Auto-speak on" : "Auto-speak off"}
              >
                {autoSpeak ? <Volume2 size={20} /> : <VolumeX size={20} />}
              </button>
            </div>

            <p className="text-center text-xs text-gray-600 mt-3">
              Powered by Free GPT API & Edge TTS — Supports English, Hindi &
              Hinglish
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
