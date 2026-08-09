const PREFERRED_LANG = 'en-US'

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  return (
    voices.find((v) => v.lang === PREFERRED_LANG) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  )
}

/** Speak English term (pronunciation). Uses browser Web Speech API. */
export function speakEnglish(text: string) {
  if (!text.trim() || typeof window === 'undefined' || !window.speechSynthesis) {
    return
  }

  window.speechSynthesis.cancel()

  const utter = new SpeechSynthesisUtterance(text.trim())
  utter.lang = PREFERRED_LANG
  utter.rate = 0.9
  const voice = pickVoice()
  if (voice) utter.voice = voice

  // Chrome sometimes needs voices loaded asynchronously
  if (!voice && window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        const v = pickVoice()
        if (v) utter.voice = v
        window.speechSynthesis.speak(utter)
      },
      { once: true },
    )
    // Fallback if voiceschanged never fires
    window.setTimeout(() => {
      if (!window.speechSynthesis.speaking) {
        window.speechSynthesis.speak(utter)
      }
    }, 250)
    return
  }

  window.speechSynthesis.speak(utter)
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}

const AUTO_SPEAK_KEY = 'english-reader:auto-speak'

export function loadAutoSpeak(): boolean {
  try {
    return localStorage.getItem(AUTO_SPEAK_KEY) === '1'
  } catch {
    return false
  }
}

export function saveAutoSpeak(value: boolean) {
  try {
    localStorage.setItem(AUTO_SPEAK_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
