import {
  TRANSLATIONS,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  LANG_LABELS,
  FLAGS,
} from './translations.js'

let currentLang = DEFAULT_LANG
const dropdowns = []
const langListeners = []

export function getCurrentLang() {
  return currentLang
}

export function t(key, vars) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANG]
  let str = dict[key] ?? TRANSLATIONS[DEFAULT_LANG][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

// The docker status response carries a platform-tagged hint key
// (e.g. `docker.hint.notRunning.darwin`). Use it to pick the right
// action label without round-tripping to main just for os.platform().
export function platformFromHintKey(hintKey) {
  if (typeof hintKey !== 'string') return null
  if (hintKey.endsWith('.darwin')) return 'darwin'
  if (hintKey.endsWith('.win32')) return 'win32'
  if (hintKey.endsWith('.linux')) return 'linux'
  return null
}

export function applyTranslations() {
  document.documentElement.lang = currentLang
  const platform = (window.platformInfo && window.platformInfo.platform) || null
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n')
    const html = node.getAttribute('data-i18n-html') === 'true'
    const platformAware = node.getAttribute('data-i18n-platform') === 'true'
    // If the node is marked platform-aware, prefer `<key>.<platform>`
    // and fall back to the base key. Used e.g. for welcome.hint to
    // mention the Windows-only reboot without showing it on macOS.
    let value = null
    if (platformAware && platform) {
      const specific = t(`${key}.${platform}`)
      if (specific && specific !== `${key}.${platform}`) value = specific
    }
    if (value === null) value = t(key)
    if (html) node.innerHTML = value
    else node.textContent = value
  }
  for (const dd of dropdowns) dd.refresh()
}

// Subscribe to lang changes. Used by modules that need to re-render
// their own DOM when the language flips (e.g. docker card has dynamic
// hints that aren't covered by [data-i18n] alone).
export function onLangChange(fn) {
  langListeners.push(fn)
  return () => {
    const idx = langListeners.indexOf(fn)
    if (idx >= 0) langListeners.splice(idx, 1)
  }
}

export function setLang(lang, { persist = true } = {}) {
  if (!SUPPORTED_LANGS.includes(lang)) return
  currentLang = lang
  if (persist) {
    try { localStorage.setItem(LANG_STORAGE_KEY, lang) } catch (_) {}
  }
  applyTranslations()
  for (const fn of langListeners) {
    try { fn(currentLang) } catch { /* ignore */ }
  }
}

// -------- Language dropdown component --------

export function initLangDropdown(root, { onPick }) {
  if (!root) return null
  const toggle = root.querySelector('.lang-select__toggle')
  const menu = root.querySelector('.lang-select__menu')
  const flagSlot = root.querySelector('[data-lang-flag]')
  const labelSlot = root.querySelector('[data-lang-label]')
  const codeSlot = root.querySelector('[data-lang-code]')

  menu.innerHTML = SUPPORTED_LANGS.map((lang) => (
    `<li role="option" data-lang="${lang}">` +
      `<button type="button" class="lang-select__item" data-lang="${lang}">` +
        `<span class="flag">${FLAGS[lang]}</span>` +
        `<span>${LANG_LABELS[lang]}</span>` +
      `</button>` +
    `</li>`
  )).join('')

  function close() {
    menu.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
  }

  function open() {
    menu.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    if (menu.hidden) open()
    else close()
  })

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-lang]')
    if (!item) return
    const lang = item.dataset.lang
    close()
    onPick(lang)
  })

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  function refresh() {
    if (flagSlot) flagSlot.innerHTML = FLAGS[currentLang]
    if (labelSlot) labelSlot.textContent = LANG_LABELS[currentLang]
    if (codeSlot) codeSlot.textContent = currentLang.toUpperCase()
    for (const item of menu.querySelectorAll('.lang-select__item')) {
      item.classList.toggle('is-active', item.dataset.lang === currentLang)
    }
  }

  const api = { refresh, close }
  dropdowns.push(api)
  return api
}
