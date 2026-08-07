type SocialNetwork = "instagram" | "tiktok";

type SocialProfile = {
  network: SocialNetwork;
  published: boolean;
  href: string;
  glyphSrc: string;
};

export const SOCIAL_PROFILES: readonly SocialProfile[] = [
  {
    network: "instagram",
    published: true,
    href: "https://www.instagram.com/jobhunterteam.ai/",
    glyphSrc: "/brand/instagram-glyph-white.svg",
  },
  {
    network: "tiktok",
    // HQ-SOCIAL deve confermare che l'account esiste prima del GO. Finché il
    // flag è false non vengono prodotti anchor, href, focus target o request.
    published: false,
    href: "https://www.tiktok.com/@jobhunterteam.ai",
    glyphSrc:
      "https://lf16-tiktok-common.ttwstatic.com/obj/tiktok-web-common-sg/mtact/static/images/logo_144c91a.png?v=2",
  },
] as const;

type FooterSocialLinksProps = {
  labels: Record<SocialNetwork, string>;
};

export function FooterSocialLinks({ labels }: FooterSocialLinksProps) {
  return (
    <div data-footer-social className="mt-4 flex items-center gap-2">
      {SOCIAL_PROFILES.filter((profile) => profile.published).map((profile) => (
        <a
          key={profile.network}
          data-social-profile={profile.network}
          href={profile.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={labels[profile.network]}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-black no-underline"
        >
          {/* Asset ufficiale invariato: niente filter, tint o transform. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.glyphSrc}
            alt=""
            aria-hidden="true"
            width={18}
            height={18}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </a>
      ))}
    </div>
  );
}
