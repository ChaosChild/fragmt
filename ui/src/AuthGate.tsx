import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	type AuthSession,
	authView,
	getAuthSession,
	logout,
	setOnAuthError,
} from "./api";

/** What the signed-in chrome (the doc head's user chip) needs. null context
 *  = auth off – the local mode keeps its exact today UI. */
export interface AuthInfo {
	login: string;
	canWrite: boolean;
	signOut: () => void;
}
const AuthContext = createContext<AuthInfo | null>(null);

/** The session seam for descendants – the doc head's user chip reads this. */
export function useAuth(): AuthInfo | null {
	return useContext(AuthContext);
}

/** The session shape the gate shows the card for (expiry and sign-out land
 *  here – enabled, nobody home). */
const SIGNED_OUT: AuthSession = { enabled: true, user: null, canWrite: false };

/**
 * #20: the auth gate, topmost in the render tree (main.tsx). Probes
 * /api/auth/session on mount and decides via authView():
 * - off      → children verbatim (local mode, zero visual change);
 * - signin   → the sign-in card, no children;
 * - app      → children under the AuthContext provider.
 * A 401 from any in-flight api call pings setOnAuthError's listener and the
 * gate flips back to the card. Enforcement is entirely server-side – this
 * gate only decides what the UI shows.
 */
export function AuthGate({ children }: { children: ReactNode }) {
	// undefined = the boot probe is still in flight.
	const [session, setSession] = useState<AuthSession | undefined>(undefined);
	// A 401 mid-session (expiry, server restart) – the page says why it is back.
	const [expired, setExpired] = useState(false);

	useEffect(() => {
		let cancelled = false;
		getAuthSession()
			.then((s) => {
				if (!cancelled) setSession(s);
			})
			.catch(() => {
				// Probe failed (server unreachable): render the app – the api
				// calls will surface the failure themselves, and enforcement
				// never lived here. Synthetic "off" keeps authView total.
				if (!cancelled)
					setSession({ enabled: false, user: null, canWrite: false });
			});
		setOnAuthError(() => {
			setExpired(true);
			setSession(SIGNED_OUT);
		});
		return () => {
			cancelled = true;
			setOnAuthError(null);
		};
	}, []);

	const signOut = useCallback(() => {
		void logout().then(() => setSession(SIGNED_OUT));
	}, []);

	if (session === undefined) {
		return (
			<div className="auth-splash">
				<span className="brand">fragmt</span>
			</div>
		);
	}
	const view = authView(session);
	if (view === "signin") return <SignIn expired={expired} />;
	if (view === "off") return <>{children}</>;
	// authView says "app", so the user is present – the guard only keeps TS
	// as honest as the pure function's contract.
	const user = session.user;
	if (!user) return <>{children}</>;
	return (
		<AuthContext.Provider
			value={{ login: user.login, canWrite: session.canWrite, signOut }}
		>
			{children}
		</AuthContext.Provider>
	);
}

const GH_MARK =
	"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

/**
 * ui v1 phase 12: the sign-in page – an art panel (two CSS paper sheets,
 * the tagline) beside the form. Nothing about the repo shows before sign-in.
 */
function SignIn({ expired }: { expired: boolean }) {
	return (
		<main className="signin">
			<div className="si-art">
				<div className="papers" aria-hidden="true">
					<div className="paper p1">
						<div className="tt" />
						<div className="ln" />
						<div className="ln" style={{ width: "80%" }} />
						<div className="ln" />
						<div className="ln" style={{ width: "60%" }} />
					</div>
					<div className="paper p2">
						<div className="tt" />
						<div className="ln" />
						<div className="ln hl" style={{ width: "70%" }} />
						<div className="ln" />
						<div className="ln" style={{ width: "85%" }} />
						<div className="ln" />
						<div className="ln" style={{ width: "40%" }} />
					</div>
				</div>
				<blockquote>
					Write docs in your repo. Ship them as Open Knowledge.
				</blockquote>
				<cite>OKF v0.2 native · plain markdown · your git history</cite>
			</div>
			<div className="si-form">
				<h1 className="wordmark">fragmt</h1>
				<p className="si-lede">
					Sign in with GitHub to read and edit these docs.{" "}
					<b>Your saves become commits under your own name.</b>
				</p>
				{expired && (
					<p className="notice" role="status">
						<span>Your session ended – sign in again to carry on.</span>
					</p>
				)}
				{/* Full page navigation on purpose: the server 302s to GitHub
				    and back to / with the session cookie set. */}
				<a className="gh-btn" href="/api/auth/login">
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d={GH_MARK} />
					</svg>
					Continue with GitHub
				</a>
				<p className="si-small">
					Your GitHub permissions on this repo decide what you can do here.
					fragmt keeps the session in memory only – nothing about you is stored
					on this server.
				</p>
			</div>
		</main>
	);
}
