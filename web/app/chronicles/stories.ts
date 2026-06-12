// Metadati condivisi delle Cronache: usati dall'indice (/chronicles) e dalle
// sottopagine (/chronicles/[slug]). Il corpo narrativo di ogni storia vive
// nella sua pagina. `published: false` = teaser nell'indice, non ancora
// cliccabile. `date` è la finestra dell'episodio reale, mostrata come kicker.

export type StoryLang = "it" | "en";

export type Story = {
  slug: string;
  emoji: string;
  date: string;
  published: boolean;
  it: { title: string; hook: string };
  en: { title: string; hook: string };
};

export const STORIES: Story[] = [
  {
    slug: "zombie-night",
    emoji: "🧟",
    date: "17–18 / 05 / 2026",
    published: true,
    it: {
      title: "In piedi non vuol dire vivo",
      hook: "Il Capitano muore a mezzanotte, ma la sua sessione resta «viva». Per ore il sistema giura che va tutto bene — finché qualcuno non guarda davvero.",
    },
    en: {
      title: "Standing isn't living",
      hook: "The Captain dies at midnight, but his session stays “alive.” For hours the system swears all is fine — until someone actually looks.",
    },
  },
  {
    slug: "bipolar-sentinel",
    emoji: "🚨",
    date: "18 / 05 / 2026",
    published: true,
    it: {
      title: "Complimenti e fucilate",
      hook: "Conosce solo due stati: «tutto ok» e «congelate tutti». Un picco passeggero gli fa fermare l'intera squadra — mentre bastava un'aspirina.",
    },
    en: {
      title: "Compliments and gunfire",
      hook: "It knows only two states: “all good” and “freeze everyone.” A passing spike makes it halt the whole team — when an aspirin would do.",
    },
  },
  {
    slug: "scout-and-london",
    emoji: "🗼",
    date: "04 / 06 / 2026",
    published: true,
    it: {
      title: "Tutti gli indizi portano a Londra",
      hook: "«Vienna, Zurigo, Milano… e niente Londra.» Lo Scout trova 72 offerte: 46 a Londra. Nessuno mente, nessun bug: una monocultura emersa dal nulla.",
    },
    en: {
      title: "All clues lead to London",
      hook: "“Vienna, Zurich, Milan… and no London.” The Scout finds 72 jobs: 46 in London. Nobody lies, no bug: a monoculture emerging from nowhere.",
    },
  },
  {
    slug: "week-nobody-saw",
    emoji: "📅",
    date: "04 / 06 / 2026",
    published: true,
    it: {
      title: "Non guardare fuori dalla finestra",
      hook: "Lo schermo dice «scade tutto fra due giorni», e la squadra lavora tutta la notte come una forsennata. Bastava alzare una serranda: di tempo ce n'era una settimana.",
    },
    en: {
      title: "Don't look out the window",
      hook: "The screen says “it all expires in two days,” and the team works itself ragged all night. One raised blind would have shown a whole week left.",
    },
  },
];

export function getStory(slug: string): Story | undefined {
  return STORIES.find((s) => s.slug === slug);
}
