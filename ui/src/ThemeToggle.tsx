import { useEffect, useState } from "react";

function initialTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "light";
	const saved = window.localStorage.getItem("theme");
	if (saved === "light" || saved === "dark") return saved;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function ThemeToggle() {
	const [theme, setTheme] = useState<"light" | "dark">(initialTheme);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		window.localStorage.setItem("theme", theme);
	}, [theme]);

	return (
		<button
			type="button"
			className="theme-toggle"
			title="Toggle theme"
			aria-label="Toggle theme"
			onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
			</svg>
		</button>
	);
}
