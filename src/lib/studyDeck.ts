import type { StudyCard } from '../types'

const KEY = 'english-reader:study-deck'

export function loadStudyDeck(): StudyCard[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StudyCard[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (c) =>
        c &&
        typeof c.term === 'string' &&
        typeof c.translation === 'string' &&
        c.term.trim() &&
        c.translation.trim(),
    )
  } catch {
    return []
  }
}

export function saveStudyDeck(cards: StudyCard[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards))
  } catch {
    /* ignore */
  }
}

export function addStudyCard(
  cards: StudyCard[],
  card: Omit<StudyCard, 'id' | 'addedAt'>,
): StudyCard[] {
  const key = card.term.toLowerCase().trim()
  const existing = cards.find((c) => c.term.toLowerCase().trim() === key)
  if (existing) {
    return cards.map((c) =>
      c.id === existing.id
        ? {
            ...c,
            translation: card.translation,
            context: card.context ?? c.context,
            explanation: card.explanation ?? c.explanation,
          }
        : c,
    )
  }

  const next: StudyCard = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    term: card.term.trim(),
    translation: card.translation.trim(),
    context: card.context,
    explanation: card.explanation,
    addedAt: Date.now(),
  }
  return [...cards, next]
}

export function removeStudyCard(cards: StudyCard[], id: string): StudyCard[] {
  return cards.filter((c) => c.id !== id)
}

export function hasStudyCard(cards: StudyCard[], term: string): boolean {
  const key = term.toLowerCase().trim()
  return cards.some((c) => c.term.toLowerCase().trim() === key)
}

export function shuffleCards(cards: StudyCard[]): StudyCard[] {
  const copy = [...cards]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}
