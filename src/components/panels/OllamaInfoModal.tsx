// "How does Ollama work?" explainer modal. Extracted verbatim from App.tsx.
import { motion, AnimatePresence } from "motion/react";
import { Server, X, AlertCircle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OllamaInfoModal({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="scriptorium-card rounded-2xl p-8 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-verdigris-400/20 flex items-center justify-center text-verdigris-400">
                  <Server size={20} />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">Running Ollama locally</h3>
                  <p className="text-white/50 text-sm">Use your own GPU/CPU for inference — no cloud, no API costs.</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-white/40 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <ol className="space-y-3 text-sm text-white/80 mb-6">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold-500/20 text-gold-300 text-xs font-bold flex items-center justify-center">1</span>
                <div>
                  Install Ollama from{" "}
                  <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="text-gold-400 underline">
                    ollama.com/download
                  </a>
                  . Available for Windows, macOS, and Linux.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold-500/20 text-gold-300 text-xs font-bold flex items-center justify-center">2</span>
                <div>
                  Start the Ollama server. On Windows it runs as a background service after install; on macOS / Linux
                  run <code className="bg-black/50 px-1.5 py-0.5 rounded text-xs font-mono text-gold-300">ollama serve</code>.
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold-500/20 text-gold-300 text-xs font-bold flex items-center justify-center">3</span>
                <div>
                  Pull at least one model. Try:
                  <pre className="bg-black/60 border border-white/5 rounded-lg p-3 mt-2 text-xs font-mono text-gold-300 overflow-x-auto">
                    ollama pull llama3.1:8b{"\n"}ollama pull phi3:mini
                  </pre>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gold-500/20 text-gold-300 text-xs font-bold flex items-center justify-center">4</span>
                <div>
                  In the Active Channel picker above, pick <strong>Ollama (local)</strong>. Set the Pro/Flash model
                  fields below to the model names you pulled.
                </div>
              </li>
            </ol>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex gap-3">
              <AlertCircle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-100/90">
                <strong className="block mb-1">A note on quality</strong>
                Local models under roughly <strong>15B parameters</strong> tend to produce noticeably weaker, less
                coherent, and less faithful answers than the frontier cloud providers (Claude, GPT-4, Gemini Pro).
                They're great for offline play, privacy, and zero API costs — but if you want NotebookLM-grade
                adherence to your source material, expect a quality gap. Larger local models (70B+) help, but need
                serious GPU/RAM.
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
