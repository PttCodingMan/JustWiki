import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import { setCalloutTitles } from './lib/calloutTitles'

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-TW', label: '正體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
]

// Map any browser-/storage-derived language tag to one of our supported codes.
// Examples: en-US → en, zh-Hant → zh-TW, zh-CN → en (we don't ship Simplified).
// Returning a tag that's in supportedLngs keeps i18next on a single resource
// bundle rather than walking the fallback chain into 'en'.
function normalizeLang(code) {
  if (!code || typeof code !== 'string') return 'en'
  const lower = code.toLowerCase()
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower.startsWith('zh-hant')) return 'zh-TW'
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('ko')) return 'ko'
  if (lower.startsWith('en')) return 'en'
  return 'en'
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-TW': { translation: zhTW },
      ja: { translation: ja },
      ko: { translation: ko },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'lang',
      caches: ['localStorage'],
      convertDetectedLanguage: normalizeLang,
    },
  })

// Keep the shared markdown callout headers in sync with the active language.
// The markdown pipeline is synchronous and shared by both render paths, so it
// reads these from a mutable module instead of calling t() directly.
function syncCalloutTitles() {
  setCalloutTitles({
    info: i18n.t('callout.info'),
    warning: i18n.t('callout.warning'),
    tip: i18n.t('callout.tip'),
    danger: i18n.t('callout.danger'),
  })
}
syncCalloutTitles()
i18n.on('languageChanged', syncCalloutTitles)

export default i18n
