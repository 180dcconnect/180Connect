"use client";

import { useState } from "react";
import {
  X,
  Minus,
  Maximize2,
  Minimize2,
  Paperclip,
  Send,
  Trash2,
  Sparkles,
  Link2,
  Smile,
} from "lucide-react";

export type GmailComposeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: { to: string; subject: string; body: string }) => void;
  initialRecipient?: string;
  initialSubject?: string;
};

export function GmailComposeModal({
  isOpen,
  onClose,
  onSend,
  initialRecipient = "",
  initialSubject = "",
}: GmailComposeModalProps) {
  const [to, setTo] = useState(initialRecipient);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  if (!isOpen) return null;

  function handleSend() {
    if (!to.trim() || !subject.trim()) {
      alert("Please specify a recipient and subject.");
      return;
    }
    onSend({ to, subject, body });
    setTo("");
    setSubject("");
    setBody("");
    onClose();
  }

  function handleAiDraft() {
    setIsAiGenerating(true);
    setTimeout(() => {
      setBody(
        `Dear Partner,\n\nI hope this email finds you well.\n\nI am writing from 180 Degrees Consulting regarding our upcoming semester pro-bono consulting projects. Our team provides end-to-end strategic consulting across operational scaling, fundraising analytics, and volunteer coordination at zero cost to registered charities.\n\nWould you have 15 minutes next week for a brief introductory call to discuss your current strategic priorities?\n\nWarm regards,\nAda Lovelace\nClient Account Manager | 180 Degrees Consulting`
      );
      if (!subject) {
        setSubject("Pro-Bono Strategic Consulting Support — 180 Degrees Consulting");
      }
      setIsAiGenerating(false);
    }, 600);
  }

  return (
    <div
      className={`fixed z-50 transition-all duration-200 bg-white rounded-t-xl border border-slate-300 shadow-2xl flex flex-col ${
        isExpanded
          ? "inset-8"
          : isMinimized
            ? "bottom-0 right-8 w-72 h-10"
            : "bottom-0 right-8 w-[580px] h-[520px]"
      }`}
    >
      {/* Compose Header */}
      <div className="flex items-center justify-between bg-slate-900 text-white px-4 py-2.5 rounded-t-xl select-none">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">New Message</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:text-white rounded"
            title={isMinimized ? "Restore" : "Minimize"}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          {!isMinimized && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:text-white rounded"
              title={isExpanded ? "Exit full screen" : "Full screen"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:text-white rounded"
            title="Save & close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body Area (hidden when minimized) */}
      {!isMinimized && (
        <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden">
          {/* Recipient Input */}
          <div className="flex items-center border-b border-slate-200 pb-2">
            <span className="text-xs text-slate-500 font-medium w-12">To:</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Recipient email or organisation..."
              className="flex-1 text-sm text-slate-800 placeholder:text-slate-400 border-0 focus:outline-none focus:ring-0 p-0"
            />
          </div>

          {/* Subject Input */}
          <div className="flex items-center border-b border-slate-200 pb-2">
            <span className="text-xs text-slate-500 font-medium w-12">Subject:</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 text-sm text-slate-800 font-medium placeholder:text-slate-400 border-0 focus:outline-none focus:ring-0 p-0"
            />
          </div>

          {/* AI Helper Banner */}
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200/80 rounded-lg px-3 py-1.5 text-xs text-emerald-800">
            <span className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              180DC Outreach Assistant
            </span>
            <button
              type="button"
              onClick={handleAiDraft}
              disabled={isAiGenerating}
              className="font-bold text-emerald-700 hover:text-emerald-900 underline cursor-pointer disabled:opacity-50"
            >
              {isAiGenerating ? "Drafting…" : "Auto-Draft Initial Outreach"}
            </button>
          </div>

          {/* Body Textarea */}
          <div className="flex-1 min-h-[160px]">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Compose your outreach email..."
              className="w-full h-full text-sm text-slate-800 placeholder:text-slate-400 border-0 focus:outline-none focus:ring-0 resize-none p-0 leading-relaxed font-sans"
            />
          </div>

          {/* Bottom Action & Formatting Bar */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-auto">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSend}
                className="flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 px-5 py-2 text-sm font-bold text-white shadow-sm transition-all cursor-pointer"
              >
                <span>Send</span>
                <Send className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                title="Attach files"
                className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <button
                type="button"
                title="Insert link"
                className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
              >
                <Link2 className="h-4 w-4" />
              </button>

              <button
                type="button"
                title="Insert emoji"
                className="p-2 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"
              >
                <Smile className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setTo("");
                setSubject("");
                setBody("");
                onClose();
              }}
              title="Discard draft"
              className="p-2 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
