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

/** What the signed-in chrome (App's user chip) needs. null context = auth
 *  off – the local mode keeps its exact today UI. */
export interface AuthInfo {
	login: string;
	canWrite: boolean;
	signOut: () => void;
}
const AuthContext = createContext<AuthInfo | null>(null);

/** The session seam for descendants – App's sidebar-head chip reads this. */
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
		setOnAuthError(() => setSession(SIGNED_OUT));
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
	if (view === "signin") {
		return (
			<div className="auth-gate">
				<div className="auth-card">
					<span className="brand">fragmt</span>
					<p className="auth-note">Sign in to open this documentation repo.</p>
					{/* Full page navigation on purpose: the server 302s to GitHub
					    and back to / with the session cookie set. */}
					<a className="iconbtn primary" href="/api/auth/login">
						Sign in with GitHub
					</a>
				</div>
			</div>
		);
	}
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
