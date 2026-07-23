// [JHT-WEB-DEMO] Profilo candidato fittizio per la modalità demo (uno per
// persona): alimenta /profile quando il cookie demo è attivo, così anche
// quella superficie è dimostrabile senza team collegato. Contenuti in
// inglese (come un CV reale, coerente con gli annunci); nomi e contatti
// chiaramente fittizi. La struttura ricalca ciò che la pagina rende:
// CandidateProfile + positioning{experience,education,...} + contatti.
import type { CandidateProfile } from "@/lib/types";
import type { DemoPersonaKey } from "@/lib/demo/data";

type DemoCandidate = {
  profile: CandidateProfile;
  contacts: Record<string, string | null>;
};

function build(
  key: DemoPersonaKey,
  p: {
    name: string;
    target_role: string;
    location: string;
    years: number;
    skills: Record<string, string[]>;
    languages: { language: string; level: string }[];
    job_titles: string[];
    salary: {
      italy_min: number;
      italy_max: number;
      eu_min: number;
      eu_max: number;
    };
    positioning: Record<string, unknown>;
  },
): DemoCandidate {
  return {
    profile: {
      id: `demo-profile-${key}`,
      user_id: `demo-user-${key}`,
      name: p.name,
      email: "demo@example.com",
      target_role: p.target_role,
      location: p.location,
      experience_years: p.years,
      experience_months: 0,
      has_degree: true,
      skills: p.skills,
      languages: p.languages,
      location_preferences: [
        { type: "remote", region: "EU", note: "Preferred" },
        { type: "hybrid", cities: [p.location.split(",")[0]], max_days: 2 },
      ],
      job_titles: p.job_titles,
      salary_target: {
        currency: "EUR",
        italy_min: p.salary.italy_min,
        italy_max: p.salary.italy_max,
        remote_eu_min: p.salary.eu_min,
        remote_eu_max: p.salary.eu_max,
      },
      positioning: p.positioning,
      created_at: new Date(Date.now() - 21 * 86400_000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    },
    contacts: {
      email: "demo@example.com",
      phone: null,
      linkedin: "linkedin.com/in/jht-demo",
      github: key === "software" ? "github.com/jht-demo" : null,
      website: null,
      address: null,
    },
  };
}

const CANDIDATES: Record<DemoPersonaKey, DemoCandidate> = {
  software: build("software", {
    name: "Alex Moretti",
    target_role: "Senior Full-stack Engineer",
    location: "Milano, IT",
    years: 7,
    skills: {
      Frontend: ["React", "TypeScript", "Next.js", "Design systems"],
      Backend: ["Node.js", "PostgreSQL", "REST/GraphQL APIs"],
      "DevOps & Cloud": ["Docker", "AWS", "CI/CD", "Terraform (basic)"],
    },
    languages: [
      { language: "Italian", level: "Native" },
      { language: "English", level: "C1" },
      { language: "Spanish", level: "B1" },
    ],
    job_titles: [
      "Senior Full-stack Engineer",
      "Senior Frontend Engineer",
      "Product Engineer",
    ],
    salary: {
      italy_min: 55000,
      italy_max: 70000,
      eu_min: 70000,
      eu_max: 90000,
    },
    positioning: {
      experience: [
        {
          role: "Senior Full-stack Engineer",
          company: "B2B SaaS scale-up (logistics)",
          period: "2022 - present",
          summary:
            "Feature ownership across a Next.js frontend and Node/Postgres services for a platform with 40k weekly users; led the design-system adoption and cut page load times by 45%.",
        },
        {
          role: "Frontend Engineer",
          company: "Digital product agency",
          period: "2019 - 2022",
          summary:
            "Built React applications for a portfolio of EU clients; introduced TypeScript and testing practices adopted agency-wide.",
        },
        {
          role: "Junior Web Developer",
          company: "E-commerce company",
          period: "2017 - 2019",
          summary:
            "Full-stack maintenance of a high-traffic storefront (PHP → Node migration).",
        },
      ],
      education: [
        {
          degree: "BSc Computer Science",
          institution: "Università degli Studi di Milano",
          year: 2017,
        },
      ],
      certifications: ["AWS Certified Developer - Associate"],
      strengths: [
        "End-to-end ownership from design to deploy",
        "Design-system thinking and DX focus",
        "Comfortable in cross-functional product squads",
      ],
      career_goals: {
        direction: "Grow towards staff engineer on product platforms",
        specializations: ["Design systems", "Web performance"],
        target_job: "Senior/Staff Product Engineer, full remote EU",
      },
      aspirations: {
        short_term:
          "Join a product team with strong engineering culture and real ownership.",
        long_term: "Staff engineer shaping platform and DX decisions.",
      },
    },
  }),
  marketing: build("marketing", {
    name: "Giulia Ferraro",
    target_role: "Growth Marketing Manager",
    location: "Roma, IT",
    years: 6,
    skills: {
      Growth: ["Funnel optimisation", "A/B testing", "GA4", "SQL (basic)"],
      "Paid & CRM": ["Meta/Google Ads", "Braze", "Lifecycle campaigns"],
      Content: ["SEO fundamentals", "Copywriting", "Editorial planning"],
    },
    languages: [
      { language: "Italian", level: "Native" },
      { language: "English", level: "C1" },
      { language: "French", level: "B2" },
    ],
    job_titles: [
      "Growth Marketing Manager",
      "Performance Marketing Lead",
      "CRM & Lifecycle Manager",
    ],
    salary: {
      italy_min: 45000,
      italy_max: 58000,
      eu_min: 55000,
      eu_max: 72000,
    },
    positioning: {
      experience: [
        {
          role: "Growth Marketing Manager",
          company: "Consumer fintech app",
          period: "2022 - present",
          summary:
            "Own the acquisition funnel (~€150k/mo across Meta, Google, TikTok); built the experiment program that lifted activation by 22%.",
        },
        {
          role: "Digital Marketing Specialist",
          company: "Travel marketplace",
          period: "2019 - 2022",
          summary:
            "Paid social and CRM journeys for 3 EU markets; introduced server-side tracking after iOS14.",
        },
        {
          role: "Marketing Assistant",
          company: "Media agency",
          period: "2018 - 2019",
          summary: "Campaign ops and reporting for consumer brands.",
        },
      ],
      education: [
        {
          degree: "MSc Marketing Management",
          institution: "LUISS Guido Carli",
          year: 2018,
        },
      ],
      certifications: ["Google Ads Search", "Meta Blueprint"],
      strengths: [
        "Experiment-driven decision making",
        "Comfortable owning six-figure monthly budgets",
        "Strong bridge between data and creative",
      ],
      career_goals: {
        direction: "Head of Growth in a product-led company",
        specializations: ["Incrementality measurement", "Lifecycle marketing"],
        target_job: "Senior Growth Manager, remote-first EU scale-up",
      },
      aspirations: {
        short_term: "Own a growth P&L with a small squad.",
        long_term: "Build and lead a full growth team.",
      },
    },
  }),
  finance: build("finance", {
    name: "Marco Riva",
    target_role: "Senior FP&A Analyst",
    location: "Milano, IT",
    years: 6,
    skills: {
      "FP&A": ["Driver-based modelling", "Forecasting", "Board reporting"],
      Tools: ["Excel (advanced)", "SQL", "Power BI", "NetSuite"],
      Accounting: ["IFRS basics", "Month-end close support"],
    },
    languages: [
      { language: "Italian", level: "Native" },
      { language: "English", level: "C1" },
      { language: "German", level: "B1" },
    ],
    job_titles: [
      "Senior FP&A Analyst",
      "Finance Business Partner",
      "Business Analyst",
    ],
    salary: {
      italy_min: 50000,
      italy_max: 65000,
      eu_min: 62000,
      eu_max: 80000,
    },
    positioning: {
      experience: [
        {
          role: "FP&A Analyst",
          company: "B2B SaaS scale-up",
          period: "2021 - present",
          summary:
            "Own the operating model and monthly forecast; partner with product leads on unit economics and pricing cases presented to the board.",
        },
        {
          role: "Financial Analyst",
          company: "Big Four advisory",
          period: "2019 - 2021",
          summary:
            "Financial due diligence and modelling on mid-market transactions across industrials and consumer.",
        },
        {
          role: "Junior Controller",
          company: "Manufacturing group",
          period: "2018 - 2019",
          summary: "Cost controlling and month-end close support.",
        },
      ],
      education: [
        {
          degree: "MSc Finance",
          institution: "Università Bocconi",
          year: 2018,
        },
      ],
      certifications: ["CFA Level II candidate"],
      strengths: [
        "Modelling rigour with business storytelling",
        "C-level exposure and board reporting",
        "SQL/BI self-service, not Excel-only",
      ],
      career_goals: {
        direction: "Finance business partner → Head of FP&A",
        specializations: ["SaaS metrics", "Pricing analytics"],
        target_job: "Senior FP&A in a tech scale-up, hybrid EU",
      },
      aspirations: {
        short_term: "Own forecasting end-to-end in a product company.",
        long_term: "Head of FP&A of a scale-up through Series C+.",
      },
    },
  }),
  design: build("design", {
    name: "Sofia Meier",
    target_role: "Senior Product Designer",
    location: "Torino, IT",
    years: 7,
    skills: {
      Product: ["End-to-end product design", "Design systems", "Prototyping"],
      Research: ["Mixed-methods research", "Usability testing"],
      Tools: ["Figma (advanced)", "Tokens/variables", "Basic HTML/CSS"],
    },
    languages: [
      { language: "Italian", level: "Native" },
      { language: "German", level: "Native" },
      { language: "English", level: "C1" },
    ],
    job_titles: [
      "Senior Product Designer",
      "Design Systems Designer",
      "UX Designer",
    ],
    salary: {
      italy_min: 48000,
      italy_max: 62000,
      eu_min: 60000,
      eu_max: 80000,
    },
    positioning: {
      experience: [
        {
          role: "Senior Product Designer",
          company: "B2B data platform",
          period: "2021 - present",
          summary:
            "Own design for complex tables, dashboards and workflows; built the multi-brand design system (tokens, variables, docs) used by 5 squads.",
        },
        {
          role: "Product Designer",
          company: "Health-tech startup",
          period: "2018 - 2021",
          summary:
            "Patient-facing mobile flows from discovery to hand-off; ran monthly usability rounds with clinicians.",
        },
        {
          role: "Visual Designer",
          company: "Brand studio",
          period: "2016 - 2018",
          summary: "Identity systems and campaign design for EU clients.",
        },
      ],
      education: [
        {
          degree: "MA Interaction Design",
          institution: "Politecnico di Milano",
          year: 2016,
        },
      ],
      certifications: [],
      strengths: [
        "Systems thinking with craft on high-density UIs",
        "Research-informed, data-comfortable",
        "Strong designer-engineer collaboration",
      ],
      career_goals: {
        direction: "Staff designer on platform/design systems",
        specializations: ["Design systems at scale", "Data-heavy products"],
        target_job: "Senior/Staff Product Designer, remote EU",
      },
      aspirations: {
        short_term: "A dedicated design-system mandate in a product org.",
        long_term: "Lead a small systems team across brands.",
      },
    },
  }),
};

export function getDemoCandidate(key: DemoPersonaKey): DemoCandidate {
  return CANDIDATES[key];
}
