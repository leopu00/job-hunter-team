// [JHT-WEB-DEMO] Indice degli overlay di traduzione della voce degli
// agenti demo. File generato dal converter del run di localizzazione:
// una voce per persona × locale (it = base nei seed, non ha overlay).
import type { Locale } from "@/i18n/config";
import type { DemoPersonaKey, SeedI18nOverlay } from "../../data";
import { SOFTWARE_EN } from "./software.en";
import { SOFTWARE_ES } from "./software.es";
import { SOFTWARE_FR } from "./software.fr";
import { SOFTWARE_DE } from "./software.de";
import { SOFTWARE_HU } from "./software.hu";
import { SOFTWARE_PT } from "./software.pt";
import { MARKETING_EN } from "./marketing.en";
import { MARKETING_ES } from "./marketing.es";
import { MARKETING_FR } from "./marketing.fr";
import { MARKETING_DE } from "./marketing.de";
import { MARKETING_HU } from "./marketing.hu";
import { MARKETING_PT } from "./marketing.pt";
import { FINANCE_EN } from "./finance.en";
import { FINANCE_ES } from "./finance.es";
import { FINANCE_FR } from "./finance.fr";
import { FINANCE_DE } from "./finance.de";
import { FINANCE_HU } from "./finance.hu";
import { FINANCE_PT } from "./finance.pt";
import { DESIGN_EN } from "./design.en";
import { DESIGN_ES } from "./design.es";
import { DESIGN_FR } from "./design.fr";
import { DESIGN_DE } from "./design.de";
import { DESIGN_HU } from "./design.hu";
import { DESIGN_PT } from "./design.pt";

export const DEMO_I18N: Record<
  DemoPersonaKey,
  Partial<Record<Locale, SeedI18nOverlay[]>>
> = {
  software: {
    en: SOFTWARE_EN,
    es: SOFTWARE_ES,
    fr: SOFTWARE_FR,
    de: SOFTWARE_DE,
    hu: SOFTWARE_HU,
    pt: SOFTWARE_PT,
  },
  marketing: {
    en: MARKETING_EN,
    es: MARKETING_ES,
    fr: MARKETING_FR,
    de: MARKETING_DE,
    hu: MARKETING_HU,
    pt: MARKETING_PT,
  },
  finance: {
    en: FINANCE_EN,
    es: FINANCE_ES,
    fr: FINANCE_FR,
    de: FINANCE_DE,
    hu: FINANCE_HU,
    pt: FINANCE_PT,
  },
  design: {
    en: DESIGN_EN,
    es: DESIGN_ES,
    fr: DESIGN_FR,
    de: DESIGN_DE,
    hu: DESIGN_HU,
    pt: DESIGN_PT,
  },
};
