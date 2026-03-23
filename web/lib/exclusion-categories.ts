export function categorizeExclusion(notes: string): string {
  const n = notes.toLowerCase()
  // 1. Tag esplicito: ESCLUSA: [CAT] o ESCLUSO: [CAT]
  const m = n.match(/esclus[ao]:\s*\[(\w+)\]/)
  if (m) return m[1].toUpperCase()
  // 2. Parsing legacy per keyword
  if (['link scaduto', 'link morto', '404', 'redirect', 'lavoro occupato', 'pagina rimossa', 'url morto'].some(k => n.includes(k))) return 'LINK_MORTO'
  if (['score < 40', 'score <40', 'score basso'].some(k => n.includes(k))) return 'SCORE_BASSO'
  if (['duplicat', 'già presente', 'stessa posizione'].some(k => n.includes(k))) return 'DUPLICATA'
  if (['us-only', 'uk-only', 'americas', 'restrizione geografica', 'work authorization uk', 'post-brexit'].some(k => n.includes(k))) return 'GEO'
  if (['lingua croata', 'tedesco obbligat', 'polacco', 'ungherese', 'français', 'dutch'].some(k => n.includes(k))) return 'LINGUA'
  if (['senior con 5+', '5+ anni obbligatori', 'seniority troppo'].some(k => n.includes(k))) return 'SENIORITY'
  if (['senza python', 'no python', 'solo java', 'solo node', 'stack incomp'].some(k => n.includes(k))) return 'STACK'
  if (['zero sviluppo', 'mismatch', 'ruolo non-dev', 'iam analyst', 'no coding'].some(k => n.includes(k))) return 'RUOLO'
  if (['scam', 'fantasma', 'red flag'].some(k => n.includes(k))) return 'SCAM'
  if (['voto critico', 'critic'].some(k => n.includes(k))) return 'CRITICO'
  return 'NON_CATEGORIZZATA'
}
