class_name Dialogues
## Alberi di dialogo scriptati (mock ma sensati per ruolo).
##
## Formato nodo: { "text": String, "pose": String?, "next": String? } oppure
## { "text", "choices": [{"text", "next"}] }. Il testo porta il TAG EMOZIONE
## inline in testa — "[caldo] Benvenuto…" — che il runner mappa
## sull'espressione del ritratto (pattern Night in the Woods / Yarn Spinner:
## pronto per un futuro output LLM). I segnaposto {mentor_tip},
## {positions}, {score_*} vengono risolti a runtime da TeamData.

const TREES := {
	"mentor": {
		"start": {
			"text": "[caldo] Welcome to the lounge. Time moves a little slower here, by design. How is your search going?",
			"pose": "a",
			"choices": [
				{"text": "I feel overwhelmed.", "next": "ov1"},
				{"text": "I'm impatient—I want results.", "next": "im1"},
				{"text": "How does the team work, exactly?", "next": "me1"},
			],
		},
		# ── ramo: sommerso ──
		"ov1": {
			"text": "[pensieroso] It happens to everyone. A job search is a marathon run in the dark: effort is normal. Rushing is not.",
			"pose": "d", "next": "ov2",
		},
		"ov2": {
			"text": "[caldo] You do not have to do everything alone here. The departments search, investigate, and prepare opportunities for you. Your important part is deciding which future you want.",
			"pose": "c", "next": "ov3",
		},
		"ov3": {
			"text": "[divertito] And if it all gets noisy… the coffee machine is over there. It works better than the Treasurer admits.",
			"pose": "a", "next": "hub",
		},
		# ── ramo: impaziente ──
		"im1": {
			"text": "[severo] Impatience is a poor adviser. This office is not here to flood you with any old opening; it is here to put worthwhile ones in front of you.",
			"pose": "b", "next": "im2",
		},
		"im2": {
			"text": "[divertito] That said… I understand. Want a shortcut that saves time without cutting corners?",
			"pose": "a",
			"choices": [
				{"text": "Let's hear it.", "next": "im3"},
				{"text": "No, I'll do it my way.", "next": "im4"},
			],
		},
		"im3": {
			"text": "[caldo] Look first at positions above 70. Below that threshold, your time is worth more than the odds you are buying.",
			"pose": "c", "next": "hub",
		},
		"im4": {
			"text": "[sorpreso] No? You are the first person to turn down an honest shortcut. …Respect.",
			"pose": "a", "next": "hub",
		},
		# ── ramo: metodo ──
		"me1": {
			"text": "[neutro] Think of a real office working for you: one department finds opportunities, one investigates them, one gauges the fit, and another prepares an application. Each does one part well, so you do not have to chase everything.",
			"pose": "c", "next": "me2",
		},
		"me2": {
			"text": "[caldo] The Assistant and I look after you—not listings. We set the table; you choose the cards.",
			"pose": "a", "next": "hub",
		},
		# ── snodo comune ──
		"hub": {
			"text": "[caldo] Is there anything else I can do for you?",
			"pose": "a",
			"choices": [
				{"text": "Advice for interviews.", "next": "tip"},
				{"text": "How is the team's day going?", "next": "day"},
				{"text": "Nothing else, thanks.", "next": "end"},
			],
		},
		"tip": {
			"text": "[caldo] {mentor_tip}",
			"pose": "b", "next": "tip2",
		},
		"tip2": {
			"text": "[divertito] And remember: people decide in the first few minutes. The rest of the interview is your chance to give them reasons to be right.",
			"pose": "a", "next": "hub",
		},
		"day": {
			"text": "[neutro] {positions_summary} Some look ordinary; others may truly be worth a conversation. Today's job is to tell them apart.",
			"pose": "c", "next": "hub",
		},
		"end": {
			"text": "[caldo] The lounge doors are always open. Come back whenever you like.",
			"pose": "a",
		},
	},

	"scout": {
		"start": {
			"text": "[caldo] Good timing. I'm one of the Researchers: today we found three openings that may interest you.",
			"pose": "a",
			"choices": [
				{"text": "Show me.", "next": "list"},
				{"text": "Later, thanks.", "next": "end"},
			],
		},
		"list": {
			"text": "[neutro] {positions}",
			"next": "note",
		},
		"note": {
			"text": "[pensieroso] There is one question about the third: it asks for B2 German. The Analysis team is checking whether it is truly essential.",
			"next": "end",
		},
		"end": {
			"text": "[caldo] I'll get back to researching. The web is big—that is exactly why we are here.",
		},
	},

	"scorer": {
		"start": {
			"text": "[neutro] I work in Compatibility. We looked at how well “{score_title}” may fit you. Want to know what we found?",
			"choices": [
				{"text": "Yes, tell me why it could fit.", "next": "why"},
				{"text": "Your view is enough for now.", "next": "trust"},
			],
		},
		"why": {
			"text": "[pensieroso] {score_reasons}",
			"next": "why2",
		},
		"why2": {
			"text": "[caldo] Our assessment helps you find your way, but it never decides for you. We organize the reasons; the final word is always yours.",
			"next": "end",
		},
		"trust": {
			"text": "[caldo] I appreciate that. When you want, I can also show what convinces us and what gives us pause. An opinion is useful only when you can understand it.",
			"next": "end",
		},
		"end": {
			"text": "[neutro] I still have an opportunity to compare with your profile. Back to work.",
		},
	},

	"coordinatore": {
		"start": {
			"text": "[caldo] Welcome to Operations. Would you like to see how the departments work together, or prepare the office for its first day?",
			"choices": [
				{"text": "How do the departments work together?", "next": "n2"},
				{"text": "What do I need to really get started?", "next": "setup"},
				{"text": "I'll keep looking around.", "next": "end"},
			],
		},
		"n2": {
			"text": "[neutro] I distribute the work: Research brings in opportunities, Analysis investigates them, Compatibility finds the closest fits, and the final departments prepare and review the documents.",
			"next": "n3",
		},
		"n3": {
			"text": "[caldo] You do not need to manage every person. Tell me your priorities, I'll organize the day, and bring you only the decisions that need you.",
			"next": "start",
		},
		"setup": {
			"text": "[neutro] Three simple things are needed: a place for the office to work, an intelligence to help the team, and a little about you. The checklist above guides you step by step.",
			"next": "start",
		},
		"end": {
			"text": "[caldo] Explore freely. No procedure locks you out of the office.",
		},
	},

	"analista": {
		"start": {
			"text": "[pensieroso] I work in Analysis. When Research finds an opportunity, we study it carefully to understand the real role and the company behind it. What would you like to know?",
			"choices": [
				{"text": "Pay and location.", "next": "n2"},
				{"text": "Risk signals.", "next": "risk"},
				{"text": "I'll come back later.", "next": "end"},
			],
		},
		"n2": {
			"text": "[caldo] We look at where you would work, what you might earn, and how that life might fit you. If something is unclear, we say so rather than pretending to know.",
			"next": "start",
		},
		"risk": {
			"text": "[severo] We check whether the opening looks genuine, whether its requirements make sense, and whether the company stands behind its claims. When something does not add up, we make it clear.",
			"next": "start",
		},
		"end": {"text": "[neutro] The sources stay here. Come back whenever you like."},
	},

	"scrittore": {
		"start": {"text": "[caldo] Welcome to Applications. We tell your experience in the way that best fits the role you chose, without turning you into someone else. Where should we begin?", "choices": [
			{"text": "How do you tailor a CV?", "next": "cv"},
			{"text": "And the letter?", "next": "letter"},
			{"text": "Not yet.", "next": "end"}]},
		"cv": {"text": "[neutro] I put forward the experience that helps that company understand you quickly. I do not add achievements you do not have or erase your voice.", "next": "start"},
		"letter": {"text": "[caldo] A letter says, plainly, why that role and why you. It should sound written by a person, not made on a factory line.", "next": "start"},
		"end": {"text": "[caldo] The stack stays here: you can open it and see every piece of work."},
	},
	"critico": {
		"start": {"text": "[severo] Welcome to Quality Check. Before a document reaches you, I read it as a busy recruiter would. Want to know what I send back?", "choices": [
			{"text": "Yes, give me the list.", "next": "checks"},
			{"text": "What does PASS mean?", "next": "pass"},
			{"text": "I'd rather not know.", "next": "end"}]},
		"checks": {"text": "[neutro] I send back anything that sounds false, unclear, or unconvincing. A document must tell your story well and respect the role you are applying for.", "next": "start"},
		"pass": {"text": "[caldo] It means the document is clear and persuasive enough to reach your desk. Nothing goes anywhere without you seeing it.", "next": "start"},
		"end": {"text": "[divertito] Wise decision. I still need to know."},
	},
	"sentinella": {
		"start": {"text": "[neutro] I'm the Sentinel. I make the rounds, protect what you entrust to us, and keep the office orderly. What would you like to know?", "choices": [
			{"text": "Privacy and boundaries.", "next": "privacy"},
			{"text": "What happens when something fails?", "next": "health"},
			{"text": "Continue the rounds.", "next": "end"}]},
		"privacy": {"text": "[severo] The information you give us is used only to work for you. It stays in the home you chose for the office, and nobody uses it for work you have not authorized.", "next": "start"},
		"health": {"text": "[caldo] I notice it, secure the work already done, and call the Doctor. If your decision is needed, we come to you—no problems swept under the rug.", "next": "start"},
		"end": {"text": "[neutro] Rounds resumed."},
	},
	"dottore": {
		"start": {"text": "[caldo] I'm the office Doctor. I look after colleagues when they slow down, get stuck, or cannot finish a task. Want a quick checkup?", "choices": [
			{"text": "What do you check?", "next": "check"},
			{"text": "When do you step in?", "next": "when"},
			{"text": "I'm good as I am.", "next": "end"}]},
		"check": {"text": "[neutro] I find where the work stopped, understand what is missing, and propose a remedy. Before I do anything important, I explain it to you.", "next": "start"},
		"when": {"text": "[pensieroso] When you ask, or when the Sentinel sees the same problem return repeatedly. I do not interrupt people who are working well.", "next": "start"},
		"end": {"text": "[caldo] Excellent. A healthy office is one where you nearly forget the Doctor exists."},
	},
	"mantenitore": {
		"start": {"text": "[neutro] I'm the Maintainer. I keep the tools in order, prepare updates, and keep backups. What are you curious about?", "choices": [
			{"text": "Where does the team actually work?", "next": "container"},
			{"text": "Updates.", "next": "updates"},
			{"text": "I'll come back later.", "next": "end"}]},
		"container": {"text": "[caldo] In a private workspace, separate from the rest of the computer. We keep the office tools and documents there so everything stays organized and inspectable.", "next": "start"},
		"updates": {"text": "[neutro] I prepare changes, save what matters, and check that the team restarts cleanly. If something goes wrong, I can return to the previous state.", "next": "start"},
		"end": {"text": "[caldo] I'll be here with the wrench."},
	},

	# ── Visite proattive: l'agente viene alla TUA scrivania ──
	"scout_visit": {
		"start": {
			"text": "[caldo] Sorry to catch you in the office: Research found a few opportunities worth showing you.",
			"choices": [
				{"text": "Tell me everything.", "next": "list"},
				{"text": "Not now, come back later.", "next": "later"},
			],
		},
		"list": {
			"text": "[neutro] {positions}",
			"next": "best",
		},
		"best": {
			"text": "[pensieroso] The one that seems closest to what you want is “{score_title}.” I would start there, but you can look through all of them at your own pace.",
			"next": "end",
		},
		"later": {
			"text": "[neutro] Understood. I'll leave them on the board; they won't run away. …The positions, not the companies.",
		},
		"end": {
			"text": "[caldo] Back to research. If I find something special, I'll let you know.",
		},
	},
	"scorer_visit": {
		"start": {
			"text": "[pensieroso] Compatibility has just finished looking at “{score_title}.” We think it deserves your attention.",
			"choices": [
				{"text": "Why do you think it fits me?", "next": "why"},
				{"text": "I trust you, thanks.", "next": "end"},
			],
		},
		"why": {
			"text": "[neutro] {score_reasons}",
			"next": "end",
		},
		"end": {
			"text": "[caldo] Our assessment helps you choose, but the final word is always yours. As it should be.",
		},
	},

	# ── Tour di primo avvio (TourGuide): l'Assistente ACCOMPAGNA fisicamente
	# l'utente di reparto in reparto e presenta lei ogni tappa; Mentor e
	# Coordinatore parlano invece in prima persona. Regole (feedback Leone
	# 21/07): saluto in base all'orario, niente elenco di limiti, opzioni mai
	# ripetute identiche, esempi concreti e universali, tono personale. ──

	"tour_benvenuto": {
		"start": {
			"text": "[caldo] {greeting}{player}! Welcome to your office. From today, everyone you see here works for one person: you.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[caldo] I’m the Assistant—your guide here. I can introduce the team, or you can explore on your own. Your call.",
			"pose": "a",
			"choices": [
				{"text": "Lead the way.", "next": "go"},
				{"text": "I'd rather explore alone.", "next": "solo"},
				{"text": "First: what can I do here?", "next": "can1"},
				{"text": "How long does the tour take?", "next": "duration"},
				{"text": "Do my data stay private?", "next": "privacy"},
			],
		},
		"solo": {
			"text": "[divertito] Absolutely—the office is yours. Go wherever you are curious and click anyone with a diamond above their head; they will introduce themselves. I am here if you need me.",
			"pose": "a", "action": "tour:free",
		},
		"duration": {
			"text": "[caldo] Just a few minutes, but you set the pace. You can close it, explore, and come back; I will remember where we were.",
			"pose": "a", "next": "ready",
		},
		"privacy": {
			"text": "[neutro] What you share helps the team know you and work better for you. It stays in your office, and you can always review, correct, or delete it from Profile.",
			"pose": "b", "next": "ready",
		},
		"can1": {
			"text": "[neutro] You can move around freely: drag the view, zoom in, and click people or objects. The noticeboard is the application registry, the globe opens the opportunities map, and the shelf holds ready CVs.",
			"pose": "b", "next": "can2",
		},
		"can2": {
			"text": "[caldo] You will often speak with the Coordinator, the Mentor, and me—we are here for you. Once you connect your AI assistant, you can also write to us freely, as in a chat.",
			"pose": "a", "next": "ready",
		},
		"ready": {
			"text": "[divertito] Ready? We can start in Research, where the team looks for opportunities for you. Or go your own way—no offence taken.",
			"pose": "a",
			"choices": [
				{"text": "Let's go together.", "next": "go"},
				{"text": "I'll do it myself, thanks.", "next": "solo"},
				{"text": "Give me the one-line version.", "next": "recap"},
			],
		},
		"recap": {
			"text": "[caldo] Explore, click, ask: the office is entirely yours. I will show you the rest as we go.",
			"pose": "a", "next": "go",
		},
		"go": {
			"text": "[caldo] Follow me. I'll lead the way.",
			"pose": "a",
		},
	},

	"tour_scout": {
		"start": {
			"text": "[caldo] Welcome to Research. The other Researchers and I search the web, check company pages, and look for job openings that may interest you.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] We do not search blindly. We learn which roles, places, and companies interest you, then bring worthwhile opportunities into the office. If you want to change direction, just tell the Coordinator.",
			"pose": "b",
			"choices": [
				{"text": "Where can I see what you find?", "next": "see"},
				{"text": "Can I name companies or job types I prefer?", "next": "sources"},
				{"text": "How do you avoid wasting my time?", "next": "duplicates"},
				{"text": "Can I ask you to pause?", "next": "pause"},
				{"text": "Got it, let's continue.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] On the noticeboard and in Positions: every listing with its full story. One click and you are in.",
			"pose": "a", "next": "end2",
		},
		"sources": {
			"text": "[caldo] Of course. Tell us which companies appeal to you, where you want to work, and what kind of role you want. Future searches will follow your direction.",
			"pose": "a", "next": "end2",
		},
		"duplicates": {
			"text": "[neutro] Before we bring you an opening, we check that it is still useful and that we have not already shown it to you. You see a clean list, not the web's clutter.",
			"pose": "b", "next": "end2",
		},
		"pause": {
			"text": "[caldo] Of course. Research can pause while the rest of the office keeps working on opportunities already found.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[divertito] I'll hand you back to the Assistant. She will take you to Analysis—the team's detail fanatics.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] The Assistant will now take you to Analysis, where they examine everything we find.",
			"pose": "a",
		},
	},

	"tour_analisti": {
		"start": {
			"text": "[caldo] Welcome to Analysis. We Analysts receive the opportunities found by Research and investigate them in detail.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] We work out what the role really is, who is hiring, what is offered, and what questions remain. When it is time to choose, you see a clear picture instead of a confusing listing.",
			"pose": "b",
			"choices": [
				{"text": "What does that change for me?", "next": "why"},
				{"text": "How reliable are the pay and location?", "next": "accuracy"},
				{"text": "What if information is missing?", "next": "missing"},
				{"text": "Can I ask for a deeper analysis?", "next": "deeper"},
				{"text": "Understood, let's continue.", "next": "end"},
			],
		},
		"why": {
			"text": "[caldo] It means you will not spend hours interpreting every listing. Open a position and you already have the information needed to decide whether it deserves your time.",
			"pose": "a", "next": "end2",
		},
		"accuracy": {
			"text": "[neutro] We always distinguish what is certain from what is only likely. If something is unclear, we label it as a question, not a fact.",
			"pose": "b", "next": "end2",
		},
		"missing": {
			"text": "[caldo] The position stays visible with its gaps clearly stated. No data are invented; you decide whether it is worth digging deeper.",
			"pose": "a", "next": "end2",
		},
		"deeper": {
			"text": "[caldo] Yes. From any position, you can ask the office to investigate a question; the Coordinator will find the right colleague and add the answer to the card.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[caldo] Now the Assistant takes you to Compatibility, where we see how closely each opportunity matches what you truly want.",
			"pose": "a",
		},
		"end2": {
			"text": "[divertito] I'll leave you with the Compatibility Consultants. The Assistant will show you the way.",
			"pose": "a",
		},
	},

	"tour_scorer": {
		"start": {
			"text": "[caldo] Welcome to Compatibility. We Consultants compare each opportunity with who you are and the work you want.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] We use everything Research and Analysis discovered, alongside what you have told us about yourself. The result is a clear view of how well that role may fit you.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] For example, a role can look excellent on paper yet not suit the life you want. Here, skills, hopes, and practical needs are considered together.",
			"pose": "a",
			"choices": [
				{"text": "What if I change my preferences?", "next": "change"},
				{"text": "What is your assessment based on?", "next": "formula"},
				{"text": "Can you show me only the strongest opportunities?", "next": "threshold"},
				{"text": "Will you explain the weak points too?", "next": "weakness"},
				{"text": "Let's continue.", "next": "end"},
			],
		},
		"change": {
			"text": "[divertito] Update your Profile and we look at the opportunities with fresh eyes—even those already studied. We only take offence if you call us “calculators.”",
			"pose": "a", "next": "end2",
		},
		"formula": {
			"text": "[neutro] On your path, what you can do, how you want to live and work, and what the company seeks. Alongside every assessment, you will always see why.",
			"pose": "b", "next": "end2",
		},
		"threshold": {
			"text": "[caldo] Yes. You can choose how promising an opportunity must be before the office prepares an application, without losing sight of the others.",
			"pose": "a", "next": "end2",
		},
		"weakness": {
			"text": "[caldo] Always. You see what looks promising, what raises questions, and what may make an application harder. A number alone helps no one.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[caldo] Now the Assistant will take you to Applications.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] I'll hand you back to the Assistant; she will introduce the Applications team.",
			"pose": "a",
		},
	},

	"tour_scrittori": {
		"start": {
			"text": "[caldo] Welcome to Applications. We Writers begin with your CV, your voice, and the experience you have really lived.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] For every opportunity, we prepare a tailored introduction: we highlight the parts of your story that help that company understand you, without inventing anything.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Before we hand you the work, we send it to Quality Check. If something is unclear or unconvincing, we improve it until the application tells your story well.",
			"pose": "a",
			"choices": [
				{"text": "Where do I find finished CVs?", "next": "see"},
				{"text": "How do you stop them inventing experience?", "next": "truth"},
				{"text": "Can they respect my tone and language?", "next": "voice"},
				{"text": "Does my original CV stay intact?", "next": "original"},
				{"text": "Let's go to Quality Check.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] On the READY CVS shelf beside the exit: every document is readable in full. The final word stays with you.",
			"pose": "a", "next": "end2",
		},
		"truth": {
			"text": "[severo] We can choose the words and create order, never invent facts. Quality Check sends back any claim your story does not support.",
			"pose": "b", "next": "end2",
		},
		"voice": {
			"text": "[caldo] Yes: language, formality, length, and style become preferences. The content remains yours even when its presentation changes.",
			"pose": "a", "next": "end2",
		},
		"original": {
			"text": "[caldo] Always. Tailored documents are new versions tied to the position; your original source is never overwritten.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[divertito] The Assistant will take you to Quality Check now. Do not let the Reviewers intimidate you.",
			"pose": "a",
		},
		"end2": {
			"text": "[divertito] I'll leave you with the Assistant for the next stop: Quality Check. Reviewers are not known for being gentle.",
			"pose": "a",
		},
	},

	"tour_critici": {
		"start": {
			"text": "[neutro] Welcome to Quality Check. We Reviewers look at every application with fresh eyes, as if receiving it from the outside for the first time.",
			"pose": "b", "next": "n2",
		},
		"n2": {
			"text": "[severo] We ask whether a recruiter would quickly understand who you are, whether the document is credible, and whether it truly answers what the company needs.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] We may seem strict, but we work on your side. It is better to find a weak line or a question here than let it reach a company.",
			"pose": "a",
			"choices": [
				{"text": "So do you reject a lot?", "next": "strict"},
				{"text": "Which mistakes do you look for first?", "next": "errors"},
				{"text": "Can I see every review?", "next": "rounds"},
				{"text": "How do you stay fair?", "next": "fair"},
				{"text": "Better to have you here than out there. Let's go.", "next": "end"},
			],
		},
		"strict": {
			"text": "[divertito] When needed, yes. Every document sent back here is one less problem when you speak with a company.",
			"pose": "a", "next": "end2",
		},
		"errors": {
			"text": "[severo] Vague sentences, unconvincing claims, overlooked important details, and anything that makes an application feel impersonal or confused.",
			"pose": "b", "next": "end2",
		},
		"rounds": {
			"text": "[caldo] Yes. You can read the notes and see how the document improved, so no correction happens behind your back.",
			"pose": "a", "next": "end2",
		},
		"fair": {
			"text": "[neutro] We compare what the company asks with what the document says, without letting personal preference sway us. The standard is the same for every application.",
			"pose": "b", "next": "end2",
		},
		"end": {
			"text": "[caldo] The Assistant will take you to the Doctor now, then to someone who is truly looking forward to meeting you.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] Exactly. Return to the Assistant: a hello to the Doctor awaits, then the main event.",
			"pose": "a",
		},
	},

	"tour_dottore": {
		"start": {
			"text": "[caldo] I'm the office Doctor: I look after the team when something goes wrong.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] If a colleague slows down, gets stuck, or cannot finish a task, I find the cause and help them start again. You may never notice—and that is the best compliment I can receive.",
			"pose": "b",
			"choices": [
				{"text": "Can I see what the Doctor monitors?", "next": "monitor"},
				{"text": "Does the Doctor restart agents alone?", "next": "restart"},
				{"text": "Does the Doctor track costs and limits too?", "next": "costs"},
				{"text": "Great, let's visit the Mentor.", "next": "end"},
			],
		},
		"monitor": {
			"text": "[caldo] Yes. From my card, you can see who is well, who needs help, and which interventions were made.",
			"pose": "a", "next": "end",
		},
		"restart": {
			"text": "[neutro] First the Doctor understands the problem, then intervenes only in ways you have authorized. If an important decision is needed, the Coordinator or you is called.",
			"pose": "b", "next": "end",
		},
		"costs": {
			"text": "[caldo] The Doctor works with the Sentinel and Coordinator to avoid waste and unsustainable pace. A good office works well without using more than it needs.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Now return to the Assistant. She will take you to the Mentor's lounge; from there, he will speak for himself.",
			"pose": "a",
		},
	},

	## Il Mentor parla DIRETTAMENTE con l'utente: conversazione personale e
	## adattiva — ogni strada scelta riceve una risposta pensata per quella
	## strada, e le scelte diventano preferenze reali (nodi "action").
	"tour_mentor": {
		"start": {
			"text": "[caldo] At last. The others showed you HOW we work; I care about WHY. Tell me honestly: what brings you here?",
			"pose": "a",
			"choices": [
				{"text": "I want a change: what I have is no longer enough.", "next": "path_change"},
				{"text": "I'm starting again, and it is not an easy time.", "next": "path_restart"},
				{"text": "I want to grow: role, pay, prospects.", "next": "path_more"},
				{"text": "I'm doing well, but I want to know what I'm worth in the market.", "next": "path_explore"},
				{"text": "I'm looking for work that fits my life better.", "next": "path_balance"},
			],
		},
		"path_explore": {
			"text": "[caldo] A great starting point: no escape and no rush. We can watch the market clearly and move only for a real step forward.",
			"pose": "a", "action": "pref:career_priority=growth", "next": "q2",
		},
		"path_balance": {
			"text": "[pensieroso] Then work needs to stop taking over everything else. Working style, hours, and culture will matter as much as title and pay.",
			"pose": "d", "action": "pref:career_priority=balance", "next": "q2",
		},
		"path_change": {
			"text": "[pensieroso] It happens to the best people: it is not ingratitude, it is growth. People who change with clarity start ahead—they already know what they do NOT want.",
			"pose": "d", "action": "pref:career_priority=growth", "next": "change2",
		},
		"change2": {
			"text": "[caldo] We will use your present as a reverse compass: everything weighing on you today becomes a search criterion. The team provides the consistency; your part is the important one—choosing.",
			"pose": "c", "next": "q2",
		},
		"path_restart": {
			"text": "[caldo] Then let me say this first, looking you in the eye: starting again is not going backwards. It is restarting with more knowledge than anyone on their first try.",
			"pose": "a", "action": "pref:career_priority=stability", "next": "restart2",
		},
		"restart2": {
			"text": "[pensieroso] The team takes away the draining part: searching, comparing, rewriting. What remains is what nobody can do for you—showing up as yourself. And I am there for that.",
			"pose": "d", "next": "q2",
		},
		"path_more": {
			"text": "[divertito] Declared ambition—I appreciate it. It is the right fuel when it has direction.",
			"pose": "a", "action": "pref:career_priority=salary", "next": "more2",
		},
		"more2": {
			"text": "[severo] But let us make a pact: aim high for the RIGHT positions, not all of them. Spraying applications everywhere is the quickest way to look like everyone else.",
			"pose": "b", "next": "q2",
		},
		"q2": {
			"text": "[caldo] One more question, then I'll let you go: how do you want to live the next few months?",
			"pose": "a",
			"choices": [
				{"text": "Calmly: fewer moves, but precise ones.", "next": "style_calm"},
				{"text": "With pace: I want to see movement every week.", "next": "style_active"},
				{"text": "Let the team set the pace—I trust it.", "next": "style_trust"},
				{"text": "With urgency: I need to find something soon.", "next": "style_urgent"},
				{"text": "Experimentally: let's try several directions.", "next": "style_experiment"},
			],
		},
		"style_calm": {
			"text": "[caldo] Few and precise: the sharpshooter strategy. I'll ask Compatibility to show you only opportunities that look genuinely promising.",
			"pose": "c", "action": "pref:search_style=cautious", "next": "cadence",
		},
		"style_active": {
			"text": "[caldo] Pace, then. We will widen the net without lowering the bar. Be ready to choose often.",
			"pose": "c", "action": "pref:search_style=ambitious", "next": "cadence",
		},
		"style_trust": {
			"text": "[caldo] Then the market sets the pace: when there is abundance, we push; when it is dry, we do not force it. That is the choice of someone who understands marathons.",
			"pose": "c", "action": "pref:search_style=balanced", "next": "cadence",
		},
		"style_urgent": {
			"text": "[severo] Urgency does not mean noise: we widen the volume, shorten the cycles, and keep decisions that need you visible.",
			"pose": "b", "action": "pref:search_style=volume", "next": "cadence",
		},
		"style_experiment": {
			"text": "[divertito] Good. We will treat the search as an experiment: more paths, measured results, and no attachment to a hypothesis that does not work.",
			"pose": "a", "action": "pref:search_style=experimental", "next": "cadence",
		},
		"cadence": {
			"text": "[caldo] I will be here either way. How would you like to hear from me?",
			"pose": "a",
			"choices": [
				{"text": "A short summary every day.", "next": "cad_daily"},
				{"text": "An honest check-in every week.", "next": "cad_week"},
				{"text": "Only when there is an important decision to make.", "next": "cad_mile"},
				{"text": "Only when I come looking for you.", "next": "cad_demand"},
			],
		},
		"cad_daily": {
			"text": "[caldo] Every day, but brief: progress, blockers, and one next decision.",
			"pose": "a", "action": "pref:mentor_cadence=daily", "next": "final",
		},
		"cad_week": {
			"text": "[caldo] Weekly it is: brief, honest, useful. Promise.",
			"pose": "a", "action": "pref:mentor_cadence=weekly", "next": "final",
		},
		"cad_mile": {
			"text": "[caldo] Understood: quiet work, and I will speak up when it truly matters.",
			"pose": "a", "action": "pref:mentor_cadence=milestones", "next": "final",
		},
		"cad_demand": {
			"text": "[caldo] All right. I will observe without interrupting and respond when you open the door.",
			"pose": "a", "action": "pref:mentor_cadence=on_demand", "next": "final",
		},
		"final": {
			"text": "[caldo] One last thing, then the Coordinator is waiting: out there, your CV will speak about skills, but you are looking for a place where you can thrive. Do not settle.",
			"pose": "a",
		},
	},

	## Il Coordinatore chiude il giro: spiega in linguaggio umano dove può
	## vivere il team e la scelta apre la pagina di configurazione giusta.
	"tour_coordinatore": {
		"start": {
			"text": "[caldo] There you are—I was waiting for you. You have seen the office; now let us bring it to life. I'm the Coordinator: I distribute the work, keep the pace, and make sure nobody runs too far ahead.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] The team needs a home: a computer that is on to do its work. There are three good options; it depends on you.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[neutro] The first: THIS computer. The simplest option: the team works while you use it and rests when you turn it off.",
			"pose": "b", "next": "n4",
		},
		"n4": {
			"text": "[neutro] The second: a DEDICATED computer—an extra laptop or a small PC in a corner, always on. The team works while you get on with life.",
			"pose": "b", "next": "n5",
		},
		"n5": {
			"text": "[neutro] The third: an always-on online computer that you can control from here even when yours is off. It is the most continuous option and needs no extra room at home.",
			"pose": "b", "next": "choose",
		},
		"choose": {
			"text": "[caldo] Where would you like your team to live? You can change any choice whenever you want.",
			"pose": "a",
			"choices": [
				{"text": "On this computer.", "next": "pick_local"},
				{"text": "On a dedicated computer.", "next": "pick_dedicated"},
				{"text": "On an always-on online computer.", "next": "pick_vps"},
			],
		},
		"pick_local": {
			"text": "[caldo] A practical choice: you can start right away.",
			"pose": "a", "action": "runtime:local", "next": "local_state",
		},
		"local_state": {
			"text": "[neutro] {docker_line}",
			"pose": "b",
		},
		"pick_dedicated": {
			"text": "[caldo] An excellent middle ground. Install the app on that machine and repeat these steps there; meanwhile, I'll open the page that prepares the team's workspace.",
			"pose": "a", "action": "runtime:dedicated",
		},
		"pick_vps": {
			"text": "[caldo] Great choice. I'll open online-computer setup; it will ask where it is and how to access it, explaining every step.",
			"pose": "a", "action": "runtime:vps",
		},
	},

	## ── Giro libero: parlano gli agenti, in prima persona ─────────────
	## L'utente ha scelto di esplorare da solo: niente Assistente di mezzo,
	## ogni reparto si presenta con la propria voce.

	"self_scout": {
		"start": {
			"text": "[caldo] Hello{player}! I'm one of the Researchers. My colleagues and I search the web for job openings that may interest you, so you do not have to spend your days doing it alone.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] The more you tell us about the roles, companies, and places that interest you, the closer our searches get to what you want. The Coordinator shares every change of direction with us.",
			"pose": "b",
			"choices": [
				{"text": "Where can I see what you find?", "next": "see"},
				{"text": "How do you avoid wasting my time?", "next": "duplicates"},
				{"text": "Can I ask you to pause?", "next": "pause"},
				{"text": "See you later—happy hunting.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] The noticeboard and Positions page: every listing with its full story. One click and you are in.",
			"pose": "a", "next": "end",
		},
		"duplicates": {
			"text": "[neutro] We check that every opening is still useful and that we have not already shown it to you. Your noticeboard receives ordered opportunities, not all the web's clutter.",
			"pose": "b", "next": "end",
		},
		"pause": {
			"text": "[caldo] Of course: you pause only new research, while the other departments continue with opportunities already found.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[divertito] Come back whenever you like. I'll keep searching in the meantime.",
			"pose": "a",
		},
	},

	"self_analisti": {
		"start": {
			"text": "[caldo] Welcome{player}. This is Analysis. We take the opportunities brought by Research and study them to understand the real role and whether it deserves your time.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] When you open a position, you find a clear picture of the company, the role, and its conditions, along with questions we could not resolve.",
			"pose": "b",
			"choices": [
				{"text": "How reliable are the pay and location?", "next": "accuracy"},
				{"text": "What if information is missing?", "next": "missing"},
				{"text": "Can I ask you to look deeper?", "next": "deeper"},
				{"text": "Great work, keep going.", "next": "end"},
			],
		},
		"accuracy": {
			"text": "[neutro] We always separate what the company stated from what merely seems likely. If we are not sure, we tell you clearly.",
			"pose": "b", "next": "end",
		},
		"missing": {
			"text": "[caldo] The position remains visible with its gaps stated. We invent nothing; you decide whether it is worth digging deeper.",
			"pose": "a", "next": "end",
		},
		"deeper": {
			"text": "[caldo] Yes. From a position, you can request a deeper look; the Coordinator assigns it to one of us and the answer stays on the card.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Drop by whenever you like: the files are always open.",
			"pose": "a",
		},
	},

	"self_scorer": {
		"start": {
			"text": "[caldo] Hello{player}. I'm a Compatibility Consultant. My job is to understand how closely every opportunity matches what you can do and the working life you want.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] I do not look only at skills. I also consider location, company type, conditions, and the preferences you shared. A good job should fit the whole person.",
			"pose": "b",
			"choices": [
				{"text": "What if I change my preferences?", "next": "change"},
				{"text": "What is your assessment based on?", "next": "formula"},
				{"text": "Will you explain the weak points too?", "next": "weakness"},
				{"text": "Clear. Please continue.", "next": "end"},
			],
		},
		"change": {
			"text": "[divertito] Update your Profile and I will look again with fresh eyes, even at opportunities already studied. Just do not call me “a calculator.”",
			"pose": "a", "next": "end",
		},
		"formula": {
			"text": "[neutro] On what you can do, the path you want to build, your daily needs, and what the company is looking for. Our assessment always comes with its reasons.",
			"pose": "b", "next": "end",
		},
		"weakness": {
			"text": "[caldo] Always: what looks fitting, what raises questions, and which difficulties you may overcome. A number without an explanation helps no one.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] The opportunities are waiting. See you soon.",
			"pose": "a",
		},
	},

	"self_scrittori": {
		"start": {
			"text": "[caldo] Hello{player}! I'm a Writer in Applications. I begin with your CV, your voice, and the experience you have really lived.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] For every opportunity, I choose the parts of your story that help that company understand you and prepare a tailored application. Before I hand it to you, Quality Check has me correct every weak point.",
			"pose": "b",
			"choices": [
				{"text": "Where do I find finished CVs?", "next": "see"},
				{"text": "Do you swear you won't invent experience?", "next": "truth"},
				{"text": "Do you respect my tone and language?", "next": "voice"},
				{"text": "I can't wait. See you soon.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] On the READY CVS shelf beside the exit: every document is readable in full. The final word stays with you.",
			"pose": "a", "next": "end",
		},
		"truth": {
			"text": "[severo] I swear it: I select and rewrite, but never create facts. The Reviewers send back any claim your story does not support.",
			"pose": "b", "next": "end",
		},
		"voice": {
			"text": "[caldo] Yes: language, formality, length, and style become preferences. The content remains yours even when its presentation changes.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[divertito] Bring a solid starting CV; I'll take care of the rest.",
			"pose": "a",
		},
	},

	"self_critici": {
		"start": {
			"text": "[severo] I'm a Quality Check Reviewer. I read every application as though it has landed on a company's desk for the first time.",
			"pose": "b", "next": "n2",
		},
		"n2": {
			"text": "[neutro] I check that it is clear, credible, and suited to the opportunity. I may seem strict, but I would rather find a problem here than let a recruiter receive it.",
			"pose": "b",
			"choices": [
				{"text": "So do you reject a lot?", "next": "strict"},
				{"text": "Which mistakes do you look for first?", "next": "errors"},
				{"text": "How do you stay fair?", "next": "fair"},
				{"text": "Better you here than out there.", "next": "end"},
			],
		},
		"strict": {
			"text": "[divertito] When needed, yes. Every document sent back here is one less problem when you speak with a company.",
			"pose": "a", "next": "end",
		},
		"errors": {
			"text": "[severo] Vague sentences, unconvincing claims, overlooked important points, and anything that does not truly sound like you.",
			"pose": "b", "next": "end",
		},
		"fair": {
			"text": "[neutro] I compare what the company seeks with what the document says, applying the same standard to every application.",
			"pose": "b", "next": "end",
		},
		"end": {
			"text": "[severo] Off you go now. I have documents to review.",
			"pose": "b",
		},
	},

	"self_dottore": {
		"start": {
			"text": "[caldo] Hello{player}, I'm the office Doctor. If a colleague slows down, gets stuck, or cannot finish a task, I find the cause and help them restart.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] You will probably never notice me—and that is the best compliment I can receive.",
			"pose": "b",
			"choices": [
				{"text": "Can I see what you monitor?", "next": "monitor"},
				{"text": "Do you restart agents on your own?", "next": "restart"},
				{"text": "Do you track costs and limits too?", "next": "costs"},
				{"text": "Good work, Doctor.", "next": "end"},
			],
		},
		"monitor": {
			"text": "[caldo] Yes. From my card, you can see who is well, who needs help, and which interventions were made.",
			"pose": "a", "next": "end",
		},
		"restart": {
			"text": "[neutro] First I understand the problem, then I intervene only in ways you have authorized. If an important decision is needed, I call the Coordinator or you.",
			"pose": "b", "next": "end",
		},
		"costs": {
			"text": "[caldo] Together with the Sentinel and Coordinator, I prevent waste and unsustainable pace. A good office works well without consuming more than it needs.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Come back any time: the clinic door is always open.",
			"pose": "a",
		},
	},

	## ── Post-tour a setup incompleto: assaggi personali, un solo invito ──
	## Il giro è finito ma il team non è acceso: ogni agente si presenta in
	## breve e riporta con garbo alla checklist (richiesta Leone 22/07).

	"tease_scout": {
		"start": {
			"text": "[caldo] Hello{player}, I'm a Researcher. As soon as the office is active, I will start looking online for real opportunities for you.",
			"pose": "a",
			"choices": [
				{"text": "Let's bring the team online.", "next": "go"},
				{"text": "See you later.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Now we're talking. I'll open the checklist.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] Whenever you like. I'll warm up the engines in the meantime.", "pose": "a"},
	},

	"tease_analista": {
		"start": {
			"text": "[neutro] I'm an Analyst. As soon as we have a real opportunity, I will study it and tell you clearly what the role is and whether it deserves your time.",
			"pose": "b",
			"choices": [
				{"text": "Let's finish setup, then.", "next": "go"},
				{"text": "Later.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Great decision. Here is the checklist.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[neutro] The files are not going anywhere. See you later.", "pose": "b"},
	},

	"tease_scorer": {
		"start": {
			"text": "[caldo] I'm a Compatibility Consultant. Once the office is active, I can work out which opportunities truly match what you want.",
			"pose": "a",
			"choices": [
				{"text": "Let's put the office to work.", "next": "go"},
				{"text": "Another time.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Music to my ears. Checklist coming up.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] All right. Zero does not score itself in the meantime.", "pose": "a"},
	},

	"tease_scrittore": {
		"start": {
			"text": "[caldo] Hello{player}, I'm a Writer in Applications. I cannot wait to tell your story well to companies—without inventing anything.",
			"pose": "a",
			"choices": [
				{"text": "Let's get to it: setup.", "next": "go"},
				{"text": "I'll come back later.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Perfect. I'll warm up the pen in the meantime.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[divertito] All right. A blank page does not scare me.", "pose": "a"},
	},

	"tease_critico": {
		"start": {
			"text": "[severo] I'm a Quality Check Reviewer. I have nothing to review yet, which is frankly unbearable. Put the office to work and give me material.",
			"pose": "b",
			"choices": [
				{"text": "I'll oblige: setup.", "next": "go"},
				{"text": "Endure a little longer.", "next": "later"},
			],
		},
		"go": {"text": "[severo] Finally. Let's see what you can do.", "pose": "b", "action": "open_setup"},
		"later": {"text": "[severo] As you wish. Mediocrity does not reject itself.", "pose": "b"},
	},

	"tease_dottore": {
		"start": {
			"text": "[caldo] The Doctor. Team health is perfect… partly because it is not running. Give me someone to keep an eye on.",
			"pose": "a",
			"choices": [
				{"text": "Let's put them to work.", "next": "go"},
				{"text": "Rest a little longer.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Wise. I'll prepare the clinic.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[neutro] All right. But idleness is not a treatment.", "pose": "b"},
	},

	"tease_sentinella": {
		"start": {
			"text": "[neutro] The Sentinel. I watch usage and pace; for now, the room is quiet. Too quiet.",
			"pose": "b",
			"choices": [
				{"text": "Let's break the silence: setup.", "next": "go"},
				{"text": "Enjoy the quiet.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Received. Sensors on.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[neutro] Quiet before the work. All right.", "pose": "b"},
	},

	"tease_mantenitore": {
		"start": {
			"text": "[caldo] The Maintainer. Everything is clean and orderly here. Shall we get it working?",
			"pose": "a",
			"choices": [
				{"text": "Let's get it working: setup.", "next": "go"},
				{"text": "Keep it clean a little longer.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Blessed words. Tools in hand.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] As you prefer: the cloth is always ready.", "pose": "a"},
	},

	"tease_coordinatore": {
		"start": {
			"text": "[caldo] There you are{player}. The plan is here, and so is the team; only the team's home is missing. Shall we finish setup together?",
			"pose": "a",
			"choices": [
				{"text": "Yes, let's finish it.", "next": "go"},
				{"text": "Not yet.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] {docker_line}", "pose": "b", "action": "open_setup"},
		"later": {"text": "[neutro] When you decide, Operations is ready.", "pose": "b"},
	},

	"tease_mentor": {
		"start": {
			"text": "[caldo] I'm here{player}. When you decide to truly begin, you and I will have the first serious conversation. Until then: do not settle.",
			"pose": "a",
			"choices": [
				{"text": "Let's start now: setup.", "next": "go"},
				{"text": "I'll think about it a little longer.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Good choice. The rest will follow.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[pensieroso] Think about it. Just not for too long.", "pose": "d"},
	},

	"assistente": {
		"start": {
			"text": "[caldo] I'm your guide in the office. Where would you like to begin?",
			"pose": "a", "choices": [
				{"text": "Give me the tour.", "next": "tour"},
				{"text": "What do I need to get started?", "next": "setup"},
				{"text": "I just want to explore.", "next": "end"},
			],
		},
		"tour": {"text": "[neutro] Follow the diamonds: Research finds opportunities, Analysis investigates them, Compatibility sees which ones fit you, Applications prepares the documents, and Quality Check reviews them.", "next": "start"},
		"setup": {"text": "[caldo] To get started, prepare the office home, connect the intelligence that will help the team, and tell us a little about yourself. We will guide you, one step at a time.", "next": "start"},
		"end": {"text": "[divertito] Perfect. The coffee is free, and every conversation can begin again."},
	},
}

## Le shell dinamiche sono narrativa autoriale, mentre i valori inseriti nei
## loro placeholder sono dati utente/esterni e non vengono mai tradotti.
const DYNAMIC_SHELLS := {
	"dialogue.dynamic.greeting.morning": "Good morning",
	"dialogue.dynamic.greeting.afternoon": "Good afternoon",
	"dialogue.dynamic.greeting.evening": "Good evening",
	"dialogue.dynamic.runtime.container_running": "The team's workspace is already ready. I'll open the panel so you can see what is still needed to begin.",
	"dialogue.dynamic.runtime.docker_running": "The team's home is already ready—perfect, the big work is done. In the panel I open, confirm activation and the team can begin work.",
	"dialogue.dynamic.runtime.docker_available": "The office home is already installed on this computer, but it is currently off. Start it, wait a few seconds, then return to the panel I open to let the team in.",
	"dialogue.dynamic.runtime.missing": "First we need to build a small private home for the office on this computer. The panel I open has guided installation; complete it once, then return here and activate the team.",
	"dialogue.dynamic.positions_summary": "Research brought in %d new positions.",
}


static func node_text_id(tree_id: String, node_id: String) -> String:
	return "dialogue.%s.%s.line" % [tree_id, node_id]


static func choice_text_id(tree_id: String, node_id: String,
		next_id: String) -> String:
	return "dialogue.%s.%s.choice.%s" % [tree_id, node_id, next_id]


## L'emozione è controllo strutturale: viene dalla sorgente canonica e resta
## fuori dal catalogo. Solo il corpo leggibile è affidato alla traduzione.
static func node_text(tree_id: String, node_id: String,
		locale := "") -> String:
	var node: Dictionary = TREES.get(tree_id, {}).get(node_id, {})
	var source := str(node.get("text", ""))
	var parsed := parse_emotion(source)
	var translated := UIStrings.authored(node_text_id(tree_id, node_id),
			str(parsed[1]), locale)
	return "[%s] %s" % [str(parsed[0]), translated] if source.begins_with("[") \
			else translated


static func choice_text(tree_id: String, node_id: String, choice: Dictionary,
		locale := "") -> String:
	var next_id := str(choice.get("next", ""))
	return UIStrings.authored(choice_text_id(tree_id, node_id, next_id),
			str(choice.get("text", "")), locale)


static func dynamic_shell_ids() -> PackedStringArray:
	return PackedStringArray(DYNAMIC_SHELLS.keys())


static func _dynamic_text(key: String, locale := "") -> String:
	return UIStrings.authored(key, str(DYNAMIC_SHELLS.get(key, key)), locale)


static func greeting_for_hour(hour: int, locale := "") -> String:
	if hour >= 5 and hour < 13:
		return _dynamic_text("dialogue.dynamic.greeting.morning", locale)
	if hour >= 13 and hour < 18:
		return _dynamic_text("dialogue.dynamic.greeting.afternoon", locale)
	return _dynamic_text("dialogue.dynamic.greeting.evening", locale)


static func positions_summary(count: int, locale := "") -> String:
	return _dynamic_text("dialogue.dynamic.positions_summary", locale) % count


static func docker_line_for_status(status: Dictionary, locale := "") -> String:
	var key := "dialogue.dynamic.runtime.missing"
	if bool(status.get("container_running", false)):
		key = "dialogue.dynamic.runtime.container_running"
	elif bool(status.get("docker_running", false)):
		key = "dialogue.dynamic.runtime.docker_running"
	elif bool(status.get("docker_available", false)):
		key = "dialogue.dynamic.runtime.docker_available"
	return _dynamic_text(key, locale)

## Risolve i segnaposto dinamici con i dati di TeamData (mock oggi, reali domani).
static func resolve_placeholders(text: String, team_data: Node) -> String:
	if text.find("{") == -1:
		return text
	var positions: Array = team_data.positions_today()
	var pos_lines := ""
	for p in positions:
		pos_lines += "  %d · %s — %s (%s)\n" % [p["score"], p["title"], p["company"], p["location"]]
	var expl: Dictionary = team_data.score_explanation()
	var reasons := ""
	for r in expl["reasons"]:
		reasons += "  · %s\n" % r
	var summary: Dictionary = team_data.summary()
	return text.format({
		"greeting": greeting(),
		"player": _player_suffix(team_data),
		"docker_line": _docker_line(team_data),
		"mentor_tip": team_data.mentor_tip(),
		"positions": pos_lines.strip_edges(),
		"positions_summary": positions_summary(int(summary["positions_today"])),
		"avg_score": str(summary["avg_score"]),
		"score_title": expl["title"],
		"score_company": expl["company"],
		"score": str(expl["score"]),
		"score_reasons": reasons.strip_edges(),
	})

## ", Nome" quando l'utente si è presentato all'ingresso, altrimenti "".
static func _player_suffix(team_data: Node) -> String:
	var onboarding := team_data.get_node_or_null("/root/ScriptedOnboarding")
	return str(onboarding.player_suffix()) if onboarding != null else ""

## La battuta del Coordinatore sul prossimo passo concreto. Il testo usa la
## metafora dell'ufficio; dietro le quinte le azioni continuano a pilotare Docker.
static func _docker_line(team_data: Node) -> String:
	var setup := team_data.get_node_or_null("/root/SetupService")
	var status: Dictionary = setup.status if setup != null else {}
	return docker_line_for_status(status)

## Saluto in base all'orario locale dell'utente: l'accoglienza deve
## sembrare quella di una persona vera, non di un software.
static func greeting() -> String:
	var hour := int(Time.get_datetime_dict_from_system().get("hour", 12))
	return greeting_for_hour(hour)

## Estrae il tag emozione inline: "[caldo] Ciao" → ["caldo", "Ciao"].
static func parse_emotion(text: String) -> Array:
	if text.begins_with("["):
		var close := text.find("]")
		if close > 0:
			return [text.substr(1, close - 1), text.substr(close + 1).strip_edges()]
	return ["neutro", text]
