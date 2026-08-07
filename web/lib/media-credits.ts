export const MUSIC_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

export const CANONICAL_MUSIC_CREDIT = [
  "Covert Affair Kevin MacLeod (incompetech.com)",
  "Licensed under Creative Commons: By Attribution 4.0",
  MUSIC_LICENSE_URL,
  "Edited for timing and mixed with a CC0 cymbal-roll intro.",
] as const;

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
