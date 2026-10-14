// ---------------------------------------------------------------------------
// codeNames.ts – pure game-logic helpers (no DOM / Astro)
// ---------------------------------------------------------------------------

export type Team = "red" | "blue";
export type CardType = "red" | "blue" | "neutral" | "assassin";

export interface Card {
	word: string;
	type: CardType;
	revealed: boolean;
}

export interface GameState {
	cards: Card[];
	/** Which team goes first (they get 9 words) */
	startingTeam: Team;
	currentTeam: Team;
	/** Counts of remaining words */
	remaining: Record<Team, number>;
	winner: Team | "assassin_red" | "assassin_blue" | null;
	/** Spymaster view active on this client? */
	spymasterView: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic seeded PRNG (mulberry32) – no external deps needed
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
	return function() {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Convert a string key to a numeric seed deterministically */
export function hashKey(key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Seeded shuffle – returns a NEW array */
function shuffleSeeded<T>(arr: T[], rng: () => number): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

// ---------------------------------------------------------------------------
// Build a board from a word pool + a game seed
// ---------------------------------------------------------------------------

/** Remove case-insensitive duplicates (a word can live in several categories) */
export function uniqueWords(words: string[]): string[] {
	const seen = new Set<string>();
	return words.filter((w) => {
		const key = w.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function buildBoard(candidates: string[], gameSeed: string): GameState {
	const wordPool = uniqueWords(candidates);
	if (wordPool.length < 25) {
		throw new Error(
			`Need at least 25 words; got ${wordPool.length}. Select more categories.`
		);
	}

	const seed = hashKey(gameSeed);
	const rng = mulberry32(seed);

	// Decide starting team with first random draw
	const startingTeam: Team = rng() < 0.5 ? "red" : "blue";
	const losingTeam: Team = startingTeam === "red" ? "blue" : "red";

	// 9 for starter, 8 for other, 1 assassin, 7 neutral = 25
	const types: CardType[] = [
		...Array(9).fill(startingTeam),
		...Array(8).fill(losingTeam),
		"assassin",
		...Array(7).fill("neutral"),
	];

	const words = shuffleSeeded(wordPool, rng).slice(0, 25);
	const shuffledTypes = shuffleSeeded(types, rng);

	const cards: Card[] = words.map((word, i) => ({
		word,
		type: shuffledTypes[i] as CardType,
		revealed: false,
	}));

	return {
		cards,
		startingTeam,
		currentTeam: startingTeam,
		remaining: { red: startingTeam === "red" ? 9 : 8, blue: startingTeam === "blue" ? 9 : 8 },
		winner: null,
		spymasterView: false,
	};
}

/** Reveal a card; returns updated state */
export function revealCard(state: GameState, index: number): GameState {
	if (state.winner || state.cards[index].revealed) return state;

	const cards = state.cards.map((c, i) =>
		i === index ? { ...c, revealed: true } : c
	);

	const card = cards[index];
	let { currentTeam, winner, remaining } = state;

	const rem = { ...remaining };

	if (card.type === "assassin") {
		winner = currentTeam === "red" ? "assassin_red" : "assassin_blue";
	} else if (card.type === "red" || card.type === "blue") {
		rem[card.type] = Math.max(0, rem[card.type] - 1);
		if (rem[card.type] === 0) {
			winner = card.type;
		} else if (card.type !== currentTeam) {
			// Hit opponent's card → switch turns
			currentTeam = card.type;
		}
		// correct guess → stays on same team (caller decides to continue or end)
	} else {
		// neutral → switch turns
		currentTeam = currentTeam === "red" ? "blue" : "red";
	}

	return { ...state, cards, currentTeam, winner, remaining: rem };
}

/** Explicitly end the current team's turn */
export function endTurn(state: GameState): GameState {
	if (state.winner) return state;
	return {
		...state,
		currentTeam: state.currentTeam === "red" ? "blue" : "red",
	};
}

/** Action log entry: a card index to reveal, or END_TURN */
export const END_TURN = -1;

/** Replay an action log (used to restore a saved game) */
export function replayLog(state: GameState, log: number[]): GameState {
	return log.reduce((s, a) => {
		if (a === END_TURN) return endTurn(s);
		return a >= 0 && a < s.cards.length ? revealCard(s, a) : s;
	}, state);
}

/** Random, URL-safe seed for a new game */
export function randomSeed(): string {
	const n = typeof crypto !== "undefined" && crypto.getRandomValues
		? crypto.getRandomValues(new Uint32Array(1))[0]
		: Math.floor(Math.random() * 2 ** 32);
	return n.toString(36);
}

/** Encode a list of selected options as a bitmask over the full option list */
export function toMask(all: readonly string[], selected: readonly string[]): string {
	let m = 0;
	all.forEach((v, i) => { if (selected.includes(v)) m |= 1 << i; });
	return m.toString(36);
}

export function fromMask(all: readonly string[], mask: string): string[] {
	const m = parseInt(mask, 36) || 0;
	return all.filter((_, i) => (m & (1 << i)) !== 0);
}
