export const MUSIC_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

export type PublicMusicCredit = {
  work: string;
  composer: string;
  source: string;
  license: string;
  licenseUrl: string;
};

/**
 * Unica attribuzione musicale pubblica. La pagina `/credits` è l'unico
 * consumer: quando i media useranno soltanto musica CC0, impostare questa
 * costante a `null` rimuoverà l'intera riga senza cercare copy sparso.
 */
export const PUBLIC_MUSIC_CREDIT: PublicMusicCredit | null = {
  work: "Covert Affair",
  composer: "Kevin MacLeod",
  source: "incompetech.com",
  license: "CC BY 4.0",
  licenseUrl: MUSIC_LICENSE_URL,
};

export const MUSIC_PROVENANCE = {
  work: "Covert Affair",
  composer: "Kevin MacLeod",
  source: "incompetech.com",
  isrc: "USUAN1100795",
  license: "CC BY 4.0",
  sourceAudioSha256:
    "279be47ea7880460be1393d66a83bcc7bee18e10d73537420098e4e1b1c0646f",
  intro: "Orch 006 cymbal roll — Karma-Ron",
  introLicense: "CC0",
  introAudioSha256:
    "215972193c783912bcd1fd249b4ed909d36d9d43145923bfb6fd3357160cd907",
} as const;
