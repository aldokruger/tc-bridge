// SoaGate: controles de carga sobre o adaptador SOA.
// - semáforo com maxConcurrency (padrão 1: adaptador Java é single-session)
// - fila limitada (queueLimit) — além disso, rejeita em vez de acumular
// - rate limit por janela fixa por (action, usuário)
// - circuit breaker: após falhas consecutivas, abre por openMs
// - timeout por operação com AbortSignal para o chamador matar o child

export class SoaGateError extends Error {
	constructor(message, code) {
		super(message);
		this.name = "SoaGateError";
		this.code = code;
	}
}

class Semaphore {
	constructor(max) {
		this.max = max;
		this.active = 0;
		this.waiters = [];
	}

	get length() {
		return this.waiters.length;
	}

	async acquire() {
		if (this.active < this.max) {
			this.active += 1;
			return () => this.release();
		}
		return new Promise((resolve) => {
			this.waiters.push(() => resolve(() => this.release()));
		});
	}

	release() {
		const next = this.waiters.shift();
		if (next) {
			next();
		} else {
			this.active = Math.max(0, this.active - 1);
		}
	}
}

export class SoaGate {
	constructor({
		maxConcurrency = 1,
		queueLimit = 4,
		rateLimitPerMinute = 30,
		breakerFailureThreshold = 3,
		breakerOpenMs = 30_000,
	} = {}) {
		this.maxConcurrency = maxConcurrency;
		this.queueLimit = queueLimit;
		this.rateLimitPerMinute = rateLimitPerMinute;
		this.breakerFailureThreshold = breakerFailureThreshold;
		this.breakerOpenMs = breakerOpenMs;

		this.semaphore = new Semaphore(maxConcurrency);
		this.rateWindows = new Map(); // key -> { windowStart, count }
		this.consecutiveFailures = 0;
		this.breakerOpenUntil = 0;
	}

	get queueLength() {
		return this.semaphore.length;
	}

	get isBreakerOpen() {
		if (this.breakerOpenUntil === 0) return false;
		if (Date.now() >= this.breakerOpenUntil) {
			this.breakerOpenUntil = 0;
			this.consecutiveFailures = 0;
			return false;
		}
		return true;
	}

	_rateKey(action, user) {
		return `${action}\u0000${user ?? "default"}`;
	}

	_checkRate(key) {
		const now = Date.now();
		const windowMs = 60_000;
		let entry = this.rateWindows.get(key);
		if (!entry || now - entry.windowStart >= windowMs) {
			entry = { windowStart: now, count: 0 };
			this.rateWindows.set(key, entry);
		}
		if (entry.count >= this.rateLimitPerMinute) {
			throw new SoaGateError(
				`rate limit SOA excedido (${this.rateLimitPerMinute}/min para esta action/usuario)`,
				"rate_limited",
			);
		}
		entry.count += 1;

		// Poda eventual das janelas antigas para não crescer sem limite.
		if (this.rateWindows.size > 1000) {
			for (const [k, e] of this.rateWindows) {
				if (now - e.windowStart >= windowMs) this.rateWindows.delete(k);
			}
		}
	}

	// operation: (signal) => Promise<result>. O signal aborta em timeout e o
	// chamador deve matar o processo filho ao ouvir o abort.
	async run(action, user, operation, { timeoutMs = 30_000 } = {}) {
		if (this.isBreakerOpen) {
			throw new SoaGateError(
				"circuit breaker SOA aberto: falhas consecutivas no adaptador",
				"circuit_open",
			);
		}
		const key = this._rateKey(action, user);
		this._checkRate(key);

		if (this.queueLength >= this.queueLimit) {
			throw new SoaGateError(
				`fila SOA cheia (${this.queueLimit} aguardando); tente novamente mais tarde`,
				"queue_full",
			);
		}

		const release = await this.semaphore.acquire();
		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort(new Error(`timeout de ${timeoutMs}ms`));
		}, timeoutMs);

		try {
			const result = await operation(controller.signal);
			this.consecutiveFailures = 0;
			return result;
		} catch (error) {
			if (timedOut) {
				this._recordFailure();
				throw new SoaGateError(
					`operacao SOA excedeu o timeout de ${timeoutMs}ms`,
					"timeout",
				);
			}
			if (error instanceof SoaGateError) throw error;
			this._recordFailure();
			throw error;
		} finally {
			clearTimeout(timer);
			release();
		}
	}

	_recordFailure() {
		this.consecutiveFailures += 1;
		if (this.consecutiveFailures >= this.breakerFailureThreshold) {
			this.breakerOpenUntil = Date.now() + this.breakerOpenMs;
		}
	}

	state() {
		return {
			active: this.semaphore.active,
			queueLength: this.queueLength,
			consecutiveFailures: this.consecutiveFailures,
			breakerOpen: this.isBreakerOpen,
			breakerOpenUntil: this.breakerOpenUntil,
			rateWindows: this.rateWindows.size,
		};
	}
}
