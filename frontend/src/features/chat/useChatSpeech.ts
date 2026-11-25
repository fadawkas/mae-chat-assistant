import { useEffect, useRef, useState } from 'react';

interface Recognition {
  start(): void;
  stop(): void;
  abort(): void;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useChatSpeech(append: (text: string) => void) {
  const { SpeechRecognition, webkitSpeechRecognition } = window as SpeechWindow;
  const Recognizer = SpeechRecognition ?? webkitSpeechRecognition;
  const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const recognition = useRef<Recognition>();
  const utterance = useRef<SpeechSynthesisUtterance>();
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState<string>();
  const [notice, setNotice] = useState('');

  useEffect(() => () => {
    const active = recognition.current;
    recognition.current = undefined;
    if (active) {
      active.onresult = active.onerror = active.onend = null;
      active.abort();
    }
    const spoken = utterance.current;
    utterance.current = undefined;
    if (spoken) {
      spoken.onend = spoken.onerror = null;
      window.speechSynthesis.cancel();
    }
  }, []);

  const dictate = () => {
    if (!Recognizer) return;
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    if (utterance.current) {
      utterance.current.onend = utterance.current.onerror = null;
      utterance.current = undefined;
      window.speechSynthesis.cancel();
      setReading(undefined);
    }
    setNotice('');
    const active = new Recognizer();
    active.lang = document.documentElement.lang || navigator.language;
    recognition.current = active;
    const finish = () => {
      if (recognition.current !== active) return;
      recognition.current = undefined;
      setListening(false);
    };
    active.onend = finish;
    active.onerror = ({ error }) => {
      if (recognition.current !== active) return;
      if (error !== 'aborted') setNotice(error === 'not-allowed' || error === 'service-not-allowed'
        ? 'Microphone access was denied. You can still type your message.'
        : 'Dictation wasn’t available. Check your microphone or type your message.');
      finish();
    };
    active.onresult = ({ results }) => {
      if (recognition.current !== active) return;
      const text = results[0]?.[0]?.transcript.trim();
      if (text) append(text);
    };
    try {
      active.start();
      setListening(true);
    } catch {
      finish();
      setNotice('Could not start dictation. You can still type your message.');
    }
  };

  const read = (id: string, text: string) => {
    if (!canSpeak || recognition.current) return;
    if (utterance.current) {
      const previous = utterance.current;
      utterance.current = undefined;
      previous.onend = previous.onerror = null;
      window.speechSynthesis.cancel();
      setReading(undefined);
      if (reading === id) return;
    }
    setNotice('');
    const spoken = new SpeechSynthesisUtterance(text);
    utterance.current = spoken;
    const finish = () => {
      if (utterance.current !== spoken) return;
      utterance.current = undefined;
      setReading(undefined);
    };
    spoken.onend = finish;
    spoken.onerror = ({ error }) => {
      if (utterance.current !== spoken) return;
      if (error !== 'canceled' && error !== 'interrupted') setNotice('Could not read this reply aloud.');
      finish();
    };
    setReading(id);
    try {
      window.speechSynthesis.speak(spoken);
    } catch {
      finish();
      setNotice('Could not read this reply aloud.');
    }
  };

  return { canDictate: Boolean(Recognizer), canSpeak, dictate, read, listening, reading, notice };
}
